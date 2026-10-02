"""Framepick processing core. Local work only; all times are on the source video timeline."""
from __future__ import annotations
from collections import deque
import hashlib
import ctypes
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import threading
import time
from datetime import datetime
import uuid
from urllib.parse import urlparse, parse_qs

import av
from PIL import Image, ImageFont, ImageChops, ImageStat

sys.path.insert(0, str(Path(__file__).parent / 'vendor'))
from video_mosaic import mosaic as upstream_mosaic
import storyboard
from tonemapping import ToneMapper

NO_WINDOW = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
MAX_FRAMES = 100_000
MAX_SHEET_PIXELS = 24_000_000
EXTERNAL_SPAWN_LOCK = threading.Lock()

class ProcessingError(Exception):
    pass

class Cancelled(ProcessingError):
    pass

def check_cancel(cancel):
    if cancel.is_set():
        raise Cancelled('任务已取消，已完成的图片已保留。')

def online_diagnostic(detail):
    lower=detail.lower()
    if any(text in lower for text in ('fresh cookies','sign in','login','log in','cookies are needed','http error 403','http error 401')):
        return '【访问状态】该视频需要有效访问状态或受到平台限制。请选择 Cookie 文件后重试，并确认浏览器能正常观看。'
    if any(text in lower for text in ('timed out','timeout','name resolution','getaddrinfo','connection refused','network is unreachable','ssl','connection reset')):
        return '【网络】未能连接视频平台。请检查网络、代理或稍后重试。'
    if any(text in lower for text in ('http error 404','video unavailable','not available','has been deleted','does not exist')):
        return '【视频不可用】链接对应的视频可能已移除、设为私密或受到地区限制，请确认该页面仍可观看。'
    if 'unsupported url' in lower:
        return '【链接类型】请选择具体视频的详情页或分享链接，主页不能确定你要处理的视频。'
    return '【解析器】未能读取视频信息。可在“设置与维护”检查解析器更新，或换用该视频的分享链接。详细原因：'+detail.splitlines()[-1][:300]

def atomic_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + '.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    temp.replace(path)

def read_json(path, fallback=None):
    try:
        return json.loads(Path(path).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return fallback

def safe_name(name):
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', name).strip(' .')[:80].rstrip(' .')
    if not cleaned:
        cleaned = '未命名视频'
    if re.fullmatch(r'(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?', cleaned, re.I):
        cleaned = '_' + cleaned
    return cleaned

def time_name(milliseconds: int, image_format='jpg'):
    seconds, fraction = divmod(milliseconds, 1000)
    text = str(seconds) + (('.' + f'{fraction:03}'.rstrip('0')) if fraction else '')
    return f'{text}s.{image_format}'

def target_times(duration, settings):
    step = float(settings['interval'])
    start = float(settings.get('start', 0))
    end = min(float(duration), float(settings['end']) if settings.get('end') is not None else float(duration))
    if not all(math.isfinite(v) for v in (step, start, end)):
        raise ProcessingError('时间设置必须是有效数字。')
    if step < .001 or start < 0 or start >= end:
        raise ProcessingError('请检查时间范围和间隔：间隔至少 0.001 秒，开始时间必须早于结束时间。')
    step_ms, start_ms = round(step * 1000), round(start * 1000)
    if abs(step_ms / 1000 - step) > 1e-8 or abs(start_ms / 1000 - start) > 1e-8:
        raise ProcessingError('时间最多支持三位小数（毫秒）。')
    first = start_ms + (0 if settings.get('includeStart') else step_ms)
    end_ms = math.ceil(end * 1000 - 1e-8)
    count = max(0, (end_ms - first + step_ms - 1) // step_ms)
    if count == 0:
        raise ProcessingError('当前范围内没有抽帧时间点，请缩短间隔或勾选“包含起点”。')
    if count > MAX_FRAMES:
        raise ProcessingError(f'本次预计超过 {MAX_FRAMES:,} 张图片，请增大间隔或缩短范围。')
    return list(range(first, end_ms, step_ms))

def validated_segments(settings, duration=None):
    segments = settings.get('cropSegments') or []
    if not isinstance(segments, list) or len(segments) > 200:
        raise ProcessingError('裁剪时段最多 200 个。')
    if any(not isinstance(item, dict) or not isinstance(item.get('start'), (int,float)) for item in segments):
        raise ProcessingError('裁剪时段格式无效。')
    previous_end = -1
    for segment in sorted(segments, key=lambda item: item.get('start', -1)):
        start, end = segment.get('start'), segment.get('end')
        if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in (start, end)) or start < 0 or end <= start or (duration and end > duration + .001):
            raise ProcessingError('裁剪时段必须在视频范围内，结束时间晚于开始时间。')
        if start < previous_end - 1e-9:
            raise ProcessingError('裁剪时段不能重叠；相接边界使用后一段。')
        previous_end = end
        rect = segment.get('rect')
        if rect is not None:
            if not isinstance(rect,dict):raise ProcessingError('裁剪时段的区域格式无效。')
            values = [rect.get(key) for key in ('x', 'y', 'width', 'height')]
            if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in values) or values[0] < 0 or values[1] < 0 or min(values[2:]) <= 0 or values[0]+values[2] > 1.000001 or values[1]+values[3] > 1.000001:
                raise ProcessingError('裁剪时段的区域超出画面。')
    return sorted(segments, key=lambda item: item['start'])

def crop_at(settings, target):
    matches = [item for item in settings.get('cropSegments', []) if item['start'] - 1e-9 <= target <= item['end'] + 1e-9]
    return max(matches, key=lambda item: item['start'])['rect'] if matches else settings.get('crop')

def _number(value, fallback=0):
    try:
        number = float(value)
        return number if math.isfinite(number) else fallback
    except (TypeError, ValueError):
        return fallback

def _rate(value):
    try:
        numerator, denominator = str(value).split('/')
        return float(numerator) / float(denominator)
    except (ValueError, ZeroDivisionError):
        return _number(value)

def _font(size):
    for name in ('C:/Windows/Fonts/msyh.ttc', 'C:/Windows/Fonts/msyhbd.ttc', 'C:/Windows/Fonts/arial.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default(size=size)

def _label(seconds):
    millis = round(seconds * 1000)
    seconds, fraction = divmod(millis, 1000)
    hours, remainder = divmod(seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    value = f'{hours}:{minutes:02}:{seconds:02}' if hours else f'{minutes:02}:{seconds:02}'
    return value + ('.' + f'{fraction:03}'.rstrip('0') if fraction else '')

# Upstream's composition logic is reused unchanged; provide Chinese fonts and millisecond labels.
upstream_mosaic.load_font = _font
upstream_mosaic.fmt_timestamp = _label

def frame_image(frame, info, max_width=None, crop=None, mapped=None):
    image = mapped.copy() if mapped is not None else frame.to_image()
    sar = info.get('sar') or 1
    if abs(sar - 1) > .001:
        image = image.resize((max(1, round(image.width * sar)), image.height), Image.Resampling.LANCZOS)
    rotation = info.get('rotation', 0)
    if rotation:
        image = image.rotate(rotation, expand=True)
    if crop:
        values = [crop.get(key) for key in ('x', 'y', 'width', 'height')]
        if any(not isinstance(v, (int, float)) or not math.isfinite(v) for v in values):
            image.close()
            raise ProcessingError('裁剪区域无效。')
        x, y, width, height = values
        if min(x, y) < 0 or min(width, height) <= 0 or x + width > 1.000001 or y + height > 1.000001:
            image.close()
            raise ProcessingError('裁剪区域超出画面。')
        left, top = round(x * image.width), round(y * image.height)
        right = max(left + 1, min(image.width, round((x + width) * image.width)))
        bottom = max(top + 1, min(image.height, round((y + height) * image.height)))
        if left >= image.width or top >= image.height:
            image.close()
            raise ProcessingError('裁剪区域太小。')
        cropped = image.crop((left, top, right, bottom))
        image.close()
        image = cropped
    if max_width and image.width > max_width:
        image = image.resize((max_width, max(1, round(image.height * max_width / image.width))), Image.Resampling.LANCZOS)
    return image

class Processor:
    def __init__(self, tools: str, cache: str):
        self.tools = Path(tools)
        self.cache = Path(cache)
        self.cache.mkdir(parents=True, exist_ok=True)

    def tool(self, name):
        if name == 'yt-dlp' and getattr(self, 'decoder', None):
            return self.decoder
        return str(self.tools / (name + '.exe' if os.name == 'nt' else name))

    def thumbnails(self, files):
        if not isinstance(files, list) or len(files) > 200:
            raise ProcessingError('一次最多读取 200 张缩略图。')
        result = []
        for file in files:
            source = Path(file).resolve()
            try:
                stat = source.stat()
                key = hashlib.sha256(f'{source}:{stat.st_mtime_ns}:{stat.st_size}:480x300'.encode()).hexdigest()
                target = self.cache / 'thumbnails' / (key + '.jpg')
                target.parent.mkdir(exist_ok=True)
                with Image.open(source) as image:
                    width, height = image.size
                    if not target.exists():
                        image.thumbnail((480,300), Image.Resampling.LANCZOS)
                        temporary=target.with_name(target.name+'.tmp-'+uuid.uuid4().hex)
                        try:
                            with image.convert('RGB') as rgb:rgb.save(temporary,format='JPEG',quality=80)
                            temporary.replace(target)
                        finally:temporary.unlink(missing_ok=True)
                result.append({'path':str(source),'thumbnail':str(target),'width':width,'height':height})
            except (OSError, ValueError):
                result.append({'path':str(source),'error':'图片丢失或无法读取'})
        return result

    def scene_times(self, source, info, settings, cancel, emit):
        start = float(settings.get('start') or 0)
        end = min(info['duration'], float(settings.get('end') or info['duration']))
        spacing = float(settings.get('interval') or 1)
        threshold = float(settings.get('sceneThreshold') or 18)
        if not all(math.isfinite(value) for value in (start,end,spacing,threshold)) or start<0 or start>=end or spacing<.001 or not 1<=threshold<=100:raise ProcessingError('场景抽帧的时间或阈值无效。')
        targets, previous, last = [], None, -math.inf
        with av.open(str(source)) as media:
            stream = next(s for s in media.streams.video if s.index == info['_streamIndex'])
            stream.codec_context.thread_count = 2
            origin = float(stream.start_time * stream.time_base) if stream.start_time is not None else info['_startTime']
            for index, frame in enumerate(media.decode(stream)):
                check_cancel(cancel)
                if frame.pts is None: raise ProcessingError('视频缺少可靠的帧时间。')
                actual = float(frame.pts*frame.time_base)-origin
                if actual >= end: break
                if actual < start: continue
                small = frame.reformat(width=32,height=18,format='rgb24').to_image()
                changed = 100 if previous is None else sum(ImageStat.Stat(ImageChops.difference(previous,small)).mean)/3/255*100
                if previous is not None: previous.close()
                previous = small
                if not targets or changed >= threshold and actual-last >= spacing-1e-8:
                    targets.append(round(actual*1000)); last=actual
                    if len(targets)>MAX_FRAMES: raise ProcessingError('场景抽帧数量超过上限，请增大最短间隔。')
                if index%120==0: emit({'stage':'分析场景变化','progress':max(0,actual/info['duration']*10)})
        if previous is not None: previous.close()
        if not targets: raise ProcessingError('当前范围内没有可用画面。')
        return sorted(set(targets))

    def health(self):
        missing = [name for name in ('ffmpeg', 'ffprobe', 'yt-dlp') if not Path(self.tool(name)).is_file()]
        return {'ready': not missing, 'message': '处理引擎已就绪' if not missing else '缺少处理工具：' + '、'.join(missing), 'av': av.__version__}

    def run(self, args, cancel=None, timeout=45, progress=None):
        """Drain both pipes, enforce timeout while the process is running, and kill on cancellation."""
        env = {key: value for key, value in os.environ.items() if not key.startswith('_PYI_')}
        env.update(PYTHONIOENCODING='utf-8', PYTHONUTF8='1', PYINSTALLER_RESET_ENVIRONMENT='1')
        frozen_root = getattr(sys, '_MEIPASS', None)
        if frozen_root:
            env['PATH'] = os.pathsep.join(item for item in env.get('PATH', '').split(os.pathsep)
                                        if not item or not Path(item).resolve().is_relative_to(Path(frozen_root).resolve()))
        try:
            with EXTERNAL_SPAWN_LOCK:
                # A frozen worker's DLL directory must not leak into independent tools.
                if os.name == 'nt' and frozen_root:
                    ctypes.windll.kernel32.SetDllDirectoryW(None)
                try:
                    process = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8', errors='replace', creationflags=NO_WINDOW,
                                               env=env, start_new_session=os.name != 'nt')
                finally:
                    if os.name == 'nt' and frozen_root:
                        ctypes.windll.kernel32.SetDllDirectoryW(str(frozen_root))
        except OSError as error:
            self._clean_cookie_copy(args)
            raise ProcessingError('无法启动处理工具，请检查安装文件是否完整。') from error
        stdout, stderr = [], deque(maxlen=250)
        def drain(pipe, lines, callback=None):
            for line in pipe:
                lines.append(line)
                if callback:
                    callback(line.strip())
        readers = [threading.Thread(target=drain, args=(process.stdout, stdout, progress), daemon=True), threading.Thread(target=drain, args=(process.stderr, stderr), daemon=True)]
        for reader in readers:
            reader.start()
        begin = time.monotonic()
        try:
            while process.poll() is None:
                if cancel:
                    check_cancel(cancel)
                if time.monotonic() - begin > timeout:
                    raise ProcessingError('处理超时，请检查网络或尝试较短的视频。')
                time.sleep(.05)
        except BaseException:
            if os.name == 'nt':
                # One-file tools launch a child which also owns the output pipes.
                # Terminate the scoped process tree so pipe readers can finish.
                subprocess.run([str(Path(os.environ.get('SystemRoot', 'C:/Windows')) / 'System32/taskkill.exe'), '/PID', str(process.pid), '/T', '/F'],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=NO_WINDOW, timeout=10)
            else:
                import signal
                os.killpg(process.pid, signal.SIGKILL)
            if process.poll() is None:
                process.kill()
            process.wait(timeout=5)
            raise
        finally:
            for reader in readers:
                reader.join(timeout=3)
            process.stdout.close()
            process.stderr.close()
            self._clean_cookie_copy(args)
        if process.returncode:
            detail = ''.join(stderr).strip()
            if Path(args[0]).name.startswith('yt-dlp'):
                raise ProcessingError(online_diagnostic(detail or '视频工具处理失败。'))
            raise ProcessingError((detail.splitlines()[-1] if detail else '视频工具处理失败。')[:600])
        return ''.join(stdout)

    def _clean_cookie_copy(self, args):
        if '--cookies' in args:
            file = Path(args[args.index('--cookies') + 1]).resolve()
            if file.is_relative_to((self.cache / 'cookies').resolve()):
                file.unlink(missing_ok=True)

    def probe(self, path, thumbnail=True):
        source = Path(path)
        if not source.is_file():
            raise ProcessingError('视频文件不存在或已被移动。')
        data = json.loads(self.run([self.tool('ffprobe'), '-v', 'error', '-show_format', '-show_streams', '-of', 'json', str(source)]))
        streams = data.get('streams', [])
        video = next((s for s in streams if s.get('codec_type') == 'video' and not s.get('disposition', {}).get('attached_pic')), None)
        if not video:
            raise ProcessingError('文件中没有可处理的视频轨道。')
        container = data.get('format', {})
        duration = _number(video.get('duration')) or _number(container.get('duration'))
        if duration <= 0:
            raise ProcessingError('无法读取有效视频时长。')
        audio = next((s for s in streams if s.get('codec_type') == 'audio'), {})
        rotation = next((_number(item.get('rotation')) for item in video.get('side_data_list', []) if 'rotation' in item), -_number(video.get('tags', {}).get('rotate')))
        sar = _rate(video.get('sample_aspect_ratio', '1/1').replace(':', '/')) or 1
        info = {
            'duration': duration, 'width': int(video.get('width') or 0), 'height': int(video.get('height') or 0),
            'fps': _rate(video.get('avg_frame_rate')) or _rate(video.get('r_frame_rate')),
            'codec': video.get('codec_name', '未知'), 'format': container.get('format_name', source.suffix.lstrip('.')),
            'size': source.stat().st_size, 'bitrate': int(_number(container.get('bit_rate'))),
            'audioCodec': audio.get('codec_name', '无音轨'), 'rotation': rotation, 'sar': sar,
            'hdr': video.get('color_transfer') in ('smpte2084', 'arib-std-b67'),
            'colorTransfer': video.get('color_transfer'), 'colorPrimaries': video.get('color_primaries'), 'colorSpace': video.get('color_space'), 'colorRange':video.get('color_range'),
            '_streamIndex': int(video['index']), '_startTime': _number(video.get('start_time'), _number(container.get('start_time')))
        }
        if info['hdr']:
            info['warning'] = '检测到 HDR 视频。默认抽帧使用 Hable 映射为 SDR，也可选择 Reinhard 或关闭；视频预览可能与导出颜色不同。'
        if thumbnail:
            try:
                key = hashlib.sha256(f'{source.resolve()}:{source.stat().st_size}:{source.stat().st_mtime_ns}'.encode()).hexdigest()[:24]
                cover = self.cache / 'covers' / (key + '.jpg')
                cover.parent.mkdir(exist_ok=True)
                if not cover.exists():
                    with av.open(str(source)) as media:
                        stream = next(s for s in media.streams.video if s.index == info['_streamIndex'])
                        stream.codec_context.thread_count = 2
                        frame = next(media.decode(stream))
                        image = frame_image(frame, info, 640)
                        image.save(cover, quality=85)
                        image.close()
                info['thumbnail'] = str(cover)
            except Exception:
                pass  # Metadata remains usable even when this decoder cannot make a poster.
        return info

    def _online_args(self, settings):
        args = [self.tool('yt-dlp'), '--ignore-config', '--no-playlist', '--no-warnings', '--socket-timeout', '15', '--retries', '1', '--ffmpeg-location', str(self.tools)]
        cookie = settings.get('cookiePath')
        if cookie:
            if not Path(cookie).is_file():
                raise ProcessingError('Cookie 文件不存在，请重新选择。')
            copies = self.cache / 'cookies'
            copies.mkdir(exist_ok=True)
            temporary = copies / (uuid.uuid4().hex + '.txt')
            shutil.copyfile(cookie, temporary)
            args += ['--cookies', str(temporary)]
        return args

    def normalize_url(self, text):
        match = re.search(r'https?://[^\s<>"\u3000]+', text)
        if not match:
            raise ProcessingError('没有找到视频链接。')
        url = match.group().rstrip('，。；、！!）)]}')
        parsed = urlparse(url)
        host = (parsed.hostname or '').lower()
        allowed = ('bilibili.com', 'b23.tv', 'douyin.com')
        if not any(host == domain or host.endswith('.' + domain) for domain in allowed):
            raise ProcessingError('当前支持 Bilibili、抖音的视频详情页或分享链接。')
        if host.endswith('douyin.com'):
            identity = (parse_qs(parsed.query).get('modal_id') or [None])[0]
            if identity and identity.isdigit():
                url = 'https://www.douyin.com/video/' + identity
            elif host in ('www.douyin.com','douyin.com') and parsed.path in ('','/'):
                raise ProcessingError('【链接类型】抖音首页不能确定视频，请复制具体视频的详情页或分享链接。')
        elif host.endswith('bilibili.com') and parsed.path in ('','/'):
            raise ProcessingError('【链接类型】Bilibili 首页不能确定视频，请复制具体视频详情页或分享链接。')
        return url

    def resolve(self, text, settings, cancel):
        url = self.normalize_url(text)
        check_cancel(cancel)
        raw = json.loads(self.run(self._online_args(settings) + ['--dump-single-json', '--skip-download', '--', url], cancel, timeout=90))
        if raw.get('_type') == 'playlist':
            entries = [item for item in raw.get('entries', []) if item]
            if not entries:
                raise ProcessingError('页面中没有可处理的视频。')
            raw = entries[0]
        selected = (raw.get('requested_formats') or [raw])
        video = next((item for item in selected if item.get('vcodec') not in ('none', None)), raw)
        return {
            'name': raw.get('title') or raw.get('id') or '在线视频', 'url': raw.get('webpage_url') or url,
            'remoteId': str(raw.get('id', '')), 'platform': '抖音' if 'douyin' in url else 'Bilibili',
            'info': {'duration': _number(raw.get('duration')), 'width': int(video.get('width') or 0), 'height': int(video.get('height') or 0),
                'fps': _number(video.get('fps')), 'codec': video.get('vcodec') or '下载后核验', 'format': raw.get('ext') or '待核验',
                'size': int(_number(video.get('filesize') or video.get('filesize_approx'))), 'bitrate': 0, 'audioCodec': '下载后核验', 'rotation': 0, 'hdr': False,
                'warning': '在线信息为预估，下载完成后会重新核验。'}
        }

    def download(self, video, settings, cancel, emit):
        directory = self.cache / 'downloads' / uuid.uuid4().hex
        directory.mkdir(parents=True)
        height = int(settings.get('onlineQuality') or 1080)
        args = self._online_args(settings) + ['--newline', '--merge-output-format', 'mp4', '-f', f'bestvideo[height<={height}]+bestaudio/best[height<={height}]', '-o', str(directory / 'video.%(ext)s'), '--print', 'after_move:FRAMEPICK_FILE:%(filepath)s', '--progress', '--progress-template', 'download:FRAMEPICK_PROGRESS:%(progress._percent_str)s', '--', video['url']]
        def progress(line):
            if line.startswith('FRAMEPICK_PROGRESS:'):
                value = re.search(r'([\d.]+)%', line)
                if value:
                    emit({'stage': '下载视频', 'progress': float(value.group(1)) * .15, 'completed': 0, 'total': 0})
        try:
            output = self.run(args, cancel, timeout=7200, progress=progress)
            paths = [line.removeprefix('FRAMEPICK_FILE:').strip() for line in output.splitlines() if line.startswith('FRAMEPICK_FILE:')]
            # Some frozen downloaders print Windows paths using the system code page.
            # The known output directory remains authoritative if that text is garbled.
            candidates = [Path(paths[-1])] if paths else []
            candidates += [directory / 'video.mp4', *directory.glob('video.*')]
            actual = next((file for file in candidates if file.resolve().parent == directory.resolve()
                           and file.is_file() and file.stat().st_size > 0
                           and re.fullmatch(r'video\.[A-Za-z0-9]+', file.name)
                           and file.suffix.lower() not in ('.part', '.ytdl', '.json')), None)
            if not actual:
                raise ProcessingError('下载完成但未找到完整视频。')
            return actual, directory
        except BaseException:
            self.remove_cache(directory)
            raise

    def remove_cache(self, directory):
        directory = Path(directory).resolve()
        if directory.is_relative_to(self.cache.resolve()) and directory != self.cache.resolve():
            shutil.rmtree(directory, ignore_errors=True)

    def download_video(self, video, settings, output_root, cancel, emit):
        if video.get('source') != 'online':
            raise ProcessingError('只有解析后的在线视频需要下载。')
        root = Path(output_root).resolve()
        root.mkdir(parents=True, exist_ok=True)
        directory = None
        partial = None
        destination = None
        committed = False
        started = time.monotonic()
        try:
            emit({'stage': '下载视频', 'progress': 0, 'completed': 0, 'total': 0})
            def progress(event):
                emit({**event, 'progress': min(90, event.get('progress', 0) * 6)})
            source, directory = self.download(video, settings, cancel, progress)
            check_cancel(cancel)
            emit({'stage': '核验视频', 'progress': 90})
            info = self.probe(source)
            stem = safe_name(video['name'])
            # Reserve a new filename without replacing any existing user file.
            for index in range(10000):
                candidate = root / (stem + (f' ({index + 1})' if index else '') + source.suffix.lower())
                try:
                    with candidate.open('xb'): pass
                    destination = candidate
                    break
                except FileExistsError:
                    continue
            if destination is None: raise ProcessingError('同名视频过多，请选择其他保存文件夹。')
            partial = root / ('.framepick-download-' + uuid.uuid4().hex + '.part')
            emit({'stage': '保存视频', 'progress': 94})
            total = source.stat().st_size
            if shutil.disk_usage(root).free < total+16*1024*1024:raise ProcessingError('视频保存位置的空间不足，请更换位置后重试。')
            copied = 0
            with source.open('rb') as incoming, partial.open('xb') as outgoing:
                while block := incoming.read(4 * 1024 * 1024):
                    check_cancel(cancel)
                    outgoing.write(block)
                    copied += len(block)
                    emit({'stage': '保存视频', 'progress': 94 + 5 * copied / total})
            check_cancel(cancel)
            partial.replace(destination)
            committed = True
            return {'downloadPath': str(destination), 'folder': str(root), 'info': info,
                    'elapsed': round(time.monotonic() - started, 2)}
        finally:
            if partial is not None: partial.unlink(missing_ok=True)
            if destination is not None and not committed: destination.unlink(missing_ok=True)
            if directory is not None: self.remove_cache(directory)

    def output_directory(self, root, name, source_key, settings, resume=None):
        root = Path(root).resolve()
        root.mkdir(parents=True, exist_ok=True)
        if resume:
            existing = Path(resume).resolve()
            if not existing.is_relative_to(root) or existing == root:
                raise ProcessingError('续作目录不在选定的输出位置中。')
            return existing
        folder = root / safe_name(name)
        owner = read_json(folder / '.framepick-source.json', {})
        if owner.get('sourceKey') not in (None, source_key):
            folder = root / (safe_name(name)[:65] + '_' + source_key[:8])
        folder.mkdir(parents=True, exist_ok=True)
        atomic_json(folder / '.framepick-source.json', {'sourceKey': source_key, 'name': name})
        if settings.get('conflict') == 'batch':
            folder = folder / ('批次_' + datetime.now().strftime('%Y%m%d_%H%M%S') + '_' + uuid.uuid4().hex[:4])
            folder.mkdir()
        if len(str(folder)) > 220:
            raise ProcessingError('保存路径过长，请选择更短的根目录。')
        return folder

    def compose(self, records, folder, settings, cancel, emit, notes=None, offset=0):
        check_cancel(cancel)
        if not records:
            raise ProcessingError('没有可拼接的图片。')
        try:
            capacity = storyboard.grid(settings)[2]
            pages = [records[i:i + capacity] for i in range(0, len(records), capacity)]
            geometries = [storyboard.plan(page, settings, notes) for page in pages]
        except (ValueError, OSError) as error:
            raise ProcessingError(str(error)) from error
        if any(g['tooLarge'] for g in geometries):
            raise ProcessingError('拼接图超过 2400 万像素，请减少行列、图片宽度或备注区高度。')
        destination = Path(folder) / '拼接'
        destination.mkdir(exist_ok=True)
        batch = datetime.now().strftime('%Y%m%d_%H%M%S') + '_' + uuid.uuid4().hex[:4]
        sheets = []
        for index, page in enumerate(pages):
            check_cancel(cancel)
            output = destination / f'拼接_{batch}_{index + 1:02}.jpg'
            partial = output.with_name(output.stem + '.part.jpg')
            def on_compose(current, total):
                check_cancel(cancel)
            try:
                storyboard.compose_page(page, partial, settings, geometries[index], notes or {}, offset + index * capacity, on_compose)
                partial.replace(output)
            except BaseException as error:
                partial.unlink(missing_ok=True)
                if isinstance(error, ValueError): raise ProcessingError(str(error)) from error
                raise
            sheets.append(str(output))
            emit({'stage': '生成拼接图', 'progress': 90 + (index + 1) / len(pages) * 9, 'completed': len(records), 'total': len(records)})
        return sheets

    def process(self, video, settings, output_root, cancel, emit, job_id, resume=None):
        started = time.monotonic()
        download_folder = None
        folder = None
        records = {}
        registry = {}
        registry_owned = False
        manifest = None
        sheets = []
        sheet_recipes = {}
        source_path = None
        info = {}
        mapper = None
        duplicate_previous = None
        omitted = set()
        try:
            check_cancel(cancel)
            if video.get('source') == 'online':
                saved = Path(video['downloadedPath']) if video.get('downloadedPath') else None
                if saved is not None and saved.is_file():
                    source_path = saved.resolve()
                else:
                    emit({'stage': '下载视频', 'progress': 0, 'completed': 0, 'total': 0})
                    source_path, download_folder = self.download(video, settings, cancel, emit)
                key_text = 'online:' + video.get('platform', '') + ':' + (video.get('remoteId') or video['url'])
            else:
                source_path = Path(video['path']).resolve()
                if not source_path.is_file():
                    raise ProcessingError('原视频文件不存在或已被移动。')
                stat = source_path.stat()
                key_text = f'local:{str(source_path).casefold()}:{stat.st_size}:{stat.st_mtime_ns}'
            emit({'stage': '核验视频', 'progress': 15 if download_folder else 0, 'completed': 0, 'total': 0})
            info = self.probe(source_path)
            emit({'info': info, 'stage': '准备抽帧'})
            validated_segments(settings, info['duration'])
            targets = self.scene_times(source_path,info,settings,cancel,emit) if settings.get('sampling') == 'scene' else target_times(info['duration'], settings)
            if info['hdr'] and settings.get('hdrMode','auto') != 'off':
                mapper = ToneMapper(self, info, 'hable' if settings.get('hdrMode','auto') == 'auto' else settings['hdrMode'], cancel)
            image_format = settings.get('format', 'jpg')
            if image_format not in ('jpg', 'png'):
                raise ProcessingError('图片格式只支持 JPG 或 PNG。')
            source_key = hashlib.sha256(key_text.encode()).hexdigest()
            folder = self.output_directory(output_root, video['name'], source_key, settings, resume)
            manifest = folder / '任务记录' / (job_id + '.json')
            emit({'stage': '抽取图片', 'folder': str(folder), 'manifest': str(manifest), 'total': len(targets), 'completed': 0})
            image_options = {key: settings.get(key) for key in ('interval', 'start', 'end', 'includeStart', 'format', 'quality', 'maxWidth')}
            if settings.get('crop'): image_options['crop'] = settings['crop']
            if settings.get('cropSegments'): image_options['cropSegments'] = settings['cropSegments']
            if settings.get('sampling') == 'scene': image_options.update(sampling='scene',sceneThreshold=settings.get('sceneThreshold',18))
            if settings.get('deduplicate'): image_options.update(deduplicate=True,similarity=settings.get('similarity',5))
            if info['hdr']: image_options['hdrMode']=settings.get('hdrMode','auto')
            options_key = hashlib.sha256(json.dumps(image_options, sort_keys=True).encode()).hexdigest()
            registry_path = folder / '.framepick-frames.json'
            old = read_json(registry_path, {})
            matches = old.get('sourceKey') == source_key and old.get('optionsKey') == options_key
            registry = old.get('frames', {}) if matches else {}
            reuse_existing = settings.get('conflict','skip') == 'skip' or bool(resume) and matches
            omitted = set(old.get('omitted',[])) if matches and reuse_existing else set()
            if settings.get('conflict', 'skip') == 'skip' and not matches and any(folder.glob('*s.*')):
                raise ProcessingError('目录已有截图，但来源或参数无法核对。请选择“覆盖已有”或“另存一批”后重试。')
            pending = []
            for target in targets:
                if target in omitted: continue
                name = time_name(target, image_format)
                path = folder / name
                entry = registry.get(name)
                if reuse_existing and path.is_file():
                    if not entry or path.stat().st_size != entry.get('size'):
                        raise ProcessingError(f'{name} 已存在但无法核验，请选择覆盖或另存一批。')
                    records[target] = {'name': name, 'path': str(path), 'target': target / 1000, 'actual': entry['actual']}
                else:
                    pending.append(target)
            registry_owned = True
            last_update = 0.0
            def persist(status='running'):
                atomic_json(registry_path, {'sourceKey': source_key, 'optionsKey': options_key, 'frames': registry, 'omitted':sorted(omitted)})
                atomic_json(manifest, {'version': 1, 'jobId': job_id, 'name': video['name'], 'sourceKey': source_key, 'settings': settings, 'info': info,
                    'video':video, 'sourcePath':str(source_path), 'omitted':sorted(omitted), 'status': status, 'frames': [records[key] for key in sorted(records)], 'sheets': sheets, 'sheetRecipes': sheet_recipes, 'elapsed': round(time.monotonic() - started, 2)})
            persist()
            emit({'stage': '抽取图片', 'completed': len(records), 'total': len(targets), 'progress': len(records) / len(targets) * 88})
            def save(frame, target, timestamp):
                nonlocal last_update, duplicate_previous
                check_cancel(cancel)
                name = time_name(target, image_format)
                path = folder / name
                temp = path.with_name(path.name + '.part')
                mapped = mapper.image(frame) if mapper else None
                image = frame_image(frame, info, int(settings['maxWidth']) if settings.get('maxWidth') else None, crop_at(settings, target / 1000),mapped)
                if mapped is not None: mapped.close()
                if settings.get('deduplicate'):
                    small=image.resize((32,18),Image.Resampling.BILINEAR)
                    if duplicate_previous is None and records:
                        last=max((key for key in records if key<target),default=None)
                        if last is not None:
                            with Image.open(records[last]['path']) as prior: duplicate_previous=prior.convert('RGB').resize((32,18),Image.Resampling.BILINEAR)
                    changed = 100 if duplicate_previous is None else sum(ImageStat.Stat(ImageChops.difference(duplicate_previous,small)).mean)/3/255*100
                    if changed <= float(settings.get('similarity',5)):
                        small.close();image.close();omitted.add(target)
                        now=time.monotonic()
                        if now-last_update>1 or len(records)+len(omitted)==len(targets):
                            emit({'stage':f'抽取图片 · 已去重 {len(omitted)} 张','completed':len(records),'total':len(targets),'progress':88*(len(records)+len(omitted))/len(targets)})
                            persist();last_update=now
                        return
                    if duplicate_previous is not None:duplicate_previous.close()
                    duplicate_previous=small
                try:
                    if shutil.disk_usage(folder).free < image.width*image.height*3 + 16*1024*1024:
                        raise ProcessingError('保存位置的剩余空间不足，已完成图片保持不变。请更换位置或清理空间后继续。')
                    image.save(temp, format='JPEG' if image_format == 'jpg' else 'PNG', **({'quality': max(1, min(100, int(settings.get('quality') or 92)))} if image_format == 'jpg' else {'compress_level': 4}))
                    check_cancel(cancel)
                    temp.replace(path)
                finally:
                    image.close()
                    temp.unlink(missing_ok=True)
                records[target] = {'name': name, 'path': str(path), 'target': target / 1000, 'actual': round(timestamp, 6), 'crop': crop_at(settings, target / 1000), 'width':image.width,'height':image.height}
                registry[name] = {'actual': round(timestamp, 6), 'size': path.stat().st_size}
                now = time.monotonic()
                if now - last_update > .15 or len(records)+len(omitted) == len(targets):
                    emit({'stage': f'抽取图片 · 已去重 {len(omitted)} 张' if omitted else '抽取图片', 'completed': len(records), 'total': len(targets), 'progress': 88 * (len(records)+len(omitted)) / len(targets)})
                if now - last_update > 1 or len(records)+len(omitted) == len(targets):
                    persist()
                    last_update = now
            if pending:
                with av.open(str(source_path)) as media:
                    stream = next(s for s in media.streams.video if s.index == info['_streamIndex'])
                    stream.codec_context.thread_count = 2
                    origin = float(stream.start_time * stream.time_base) if stream.start_time is not None else info['_startTime']
                    try:
                        media.seek(int((pending[0] / 1000 + origin) / stream.time_base), stream=stream, backward=True, any_frame=False)
                    except (av.FFmpegError, ValueError):
                        media.seek(0)
                    previous, previous_time = None, None
                    index = 0
                    for frame in media.decode(stream):
                        check_cancel(cancel)
                        if frame.pts is None:
                            raise ProcessingError('视频缺少帧时间信息，无法可靠地按时间抽帧。')
                        actual = float(frame.pts * frame.time_base) - origin
                        while index < len(pending) and pending[index] / 1000 <= actual + 1e-9:
                            target = pending[index] / 1000
                            use_previous = previous is not None and abs(target - previous_time) <= abs(actual - target) + 1e-9
                            save(previous if use_previous else frame, pending[index], previous_time if use_previous else actual)
                            index += 1
                        if index == len(pending):
                            break
                        previous, previous_time = frame, actual
                    if index < len(pending):
                        if previous is None:
                            raise ProcessingError('未能解码出有效画面。')
                        while index < len(pending):
                            save(previous, pending[index], previous_time)
                            index += 1
            check_cancel(cancel)
            if settings.get('autoStitch'):
                ordered = [records[key] for key in sorted(records)]
                sheets = self.compose(ordered, folder, settings, cancel, emit)
                capacity = storyboard.grid(settings)[2]
                for index, sheet in enumerate(sheets):
                    names = [item['name'] for item in ordered[index * capacity:(index + 1) * capacity]]
                    sheet_recipes[sheet] = {'names': names, 'settings': settings, 'notes': {name: '' for name in names}, 'offset': index * capacity}
            persist('done')
            return {'folder': str(folder), 'manifest': str(manifest), 'count': len(records), 'completed':len(records),'stage':f'处理完成 · 去重 {len(omitted)} 张' if omitted else '处理完成','sheets': sheets, 'elapsed': round(time.monotonic() - started, 2)}
        except BaseException as error:
            if manifest and folder:
                # Cooperative cancellation preserves the last completed frame and enables verified retries.
                if registry_owned and 'registry_path' in locals() and 'source_key' in locals():
                    atomic_json(registry_path, {'sourceKey': source_key, 'optionsKey': options_key, 'frames': registry, 'omitted':sorted(omitted)})
                atomic_json(manifest, {'version': 1, 'jobId': job_id, 'name': video['name'], 'settings': settings, 'info': info,
                    'status': 'cancelled' if isinstance(error, Cancelled) else 'error', 'frames': [records[key] for key in sorted(records)], 'sheets': sheets,
                    'error': str(error), 'elapsed': round(time.monotonic() - started, 2)})
                emit({'folder': str(folder), 'manifest': str(manifest), 'completed': len(records), 'count': len(records), 'sheets': sheets})
            raise
        finally:
            if mapper: mapper.close()
            if duplicate_previous is not None:duplicate_previous.close()
            if download_folder and not settings.get('keepDownload'):
                self.remove_cache(download_folder)

    def _stitch_records(self, manifest_path, names, settings=None):
        manifest_path = Path(manifest_path)
        manifest = read_json(manifest_path)
        if not manifest:
            raise ProcessingError('未找到任务记录。')
        requested = set(names)
        frames = sorted([item for item in manifest['frames'] if not requested or item['name'] in requested], key=lambda item: item['target'])
        value = settings or {}
        if value.get('preserveOrder'):
            order = names or value.get('frameOrder') or manifest.get('stitchDraft',{}).get('frameOrder') or []
            positions = {name:index for index,name in enumerate(order)}
            frames.sort(key=lambda item:(positions.get(item['name'],len(order)),item['target']))
        folder = manifest_path.parent.parent.resolve()
        if any(not Path(item['path']).resolve().is_relative_to(folder) for item in frames):
            raise ProcessingError('任务记录中的图片路径无效。')
        if requested - {item['name'] for item in frames}:
            raise ProcessingError('所选图片已不在任务记录中，请重新选择。')
        missing = [item for item in frames if not Path(item['path']).is_file()]
        if requested and missing: raise ProcessingError('所选图片中有文件缺失，请替换或恢复后再拼接。')
        frames = [item for item in frames if Path(item['path']).is_file()]
        return manifest_path, manifest, frames, folder

    def preview_manifest(self, manifest_path, names, settings, page=0, notes=None, offset=0):
        _, manifest, frames, _ = self._stitch_records(manifest_path, names, settings)
        if not frames: raise ProcessingError('没有可拼接的图片。')
        try:
            capacity = storyboard.grid(settings)[2]
            page = min(max(0, int(page)), math.ceil(len(frames) / capacity) - 1)
            start = page * capacity
            geometry = storyboard.plan(frames[start:start + capacity], settings, manifest.get('notes', {}) if notes is None else notes)
        except (ValueError, OSError) as error:
            raise ProcessingError(str(error)) from error
        return {**geometry, 'order':[item['name'] for item in frames], 'frames': frames[start:start + capacity], 'page': page, 'offset': offset + start, 'total': len(frames), 'pages': math.ceil(len(frames) / capacity)}

    def save_stitch_draft(self, manifest_path, notes, settings):
        file, manifest, _, _ = self._stitch_records(manifest_path, [])
        if not isinstance(notes, dict): raise ProcessingError('备注格式无效。')
        allowed = {item['name'] for item in manifest['frames']}
        cleaned = {}
        for name, text in notes.items():
            if name not in allowed: continue
            if not isinstance(text, str) or len(text) > 1000:
                raise ProcessingError('每张图片的备注最多支持 1000 个字符。')
            if text: cleaned[name] = text
        manifest['notes'] = cleaned
        manifest['stitchDraft'] = settings
        atomic_json(file, manifest)
        return {'saved': True}

    def stitch_manifest(self, manifest_path, names, settings, cancel, emit, page=None, offset=0):
        file, manifest, frames, folder = self._stitch_records(manifest_path, names, settings)
        capacity = storyboard.grid(settings)[2]
        if page is not None:
            start = max(0, int(page)) * capacity
            if start >= len(frames): raise ProcessingError('所选拼接页不存在，请重新选择。')
            frames = frames[start:start + capacity]
            offset += start
        notes = manifest.get('notes', {})
        sheets = self.compose(frames, folder, settings, cancel, emit, notes, offset)
        manifest.setdefault('sheets', []).extend(sheets)
        manifest['stitchDraft'] = settings
        manifest.setdefault('stitchHistory', []).append({'sheets': sheets, 'settings': settings, 'names': [item['name'] for item in frames]})
        recipes = manifest.setdefault('sheetRecipes', {})
        for index, sheet in enumerate(sheets):
            items = frames[index * capacity:(index + 1) * capacity]
            recipes[sheet] = {'names': [item['name'] for item in items], 'settings': settings,
                             'notes': {item['name']: notes.get(item['name'], '') for item in items}, 'offset': offset + index * capacity}
        atomic_json(file, manifest)
        return {'sheets': manifest['sheets']}
