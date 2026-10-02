import json
import os
import subprocess
import sys
import time
import ctypes
from pathlib import Path
import threading

import av
import pytest
from PIL import Image, ImageChops
from core import Cancelled, ProcessingError, safe_name, target_times, time_name

def run(processor, source, parameters, root, job='test', emit=lambda event: None, cancel=None, name='测试视频'):
    return processor.process({'source': 'local', 'path': str(source), 'name': name}, parameters, str(root), cancel or threading.Event(), emit, job)

def manifest(result):
    return json.loads(Path(result['manifest']).read_text(encoding='utf-8'))

def decoded(source):
    with av.open(str(source)) as media:
        stream = media.streams.video[0]
        origin = float(stream.start_time * stream.time_base) if stream.start_time is not None else 0
        return [(float(frame.pts * frame.time_base) - origin, frame.to_image()) for frame in media.decode(stream)]

def test_time_grid_is_end_exclusive_and_names_preserve_milliseconds(parameters):
    assert target_times(10, parameters) == list(range(500, 10000, 500))
    assert target_times(10, {**parameters, 'includeStart': True}) == list(range(0, 10000, 500))
    assert target_times(2, {**parameters, 'start': .25, 'interval': .125, 'end': .8}) == [375, 500, 625, 750]
    assert [time_name(n) for n in (500, 1000, 1500, 125)] == ['0.5s.jpg', '1s.jpg', '1.5s.jpg', '0.125s.jpg']
    with pytest.raises(ProcessingError): target_times(1, {**parameters, 'interval': 2})
    with pytest.raises(ProcessingError): target_times(1000, {**parameters, 'interval': .001})

def test_cfr_saved_pixels_match_the_requested_video_frames(processor, fixtures, parameters, tmp_path):
    result = run(processor, fixtures['cfr'], parameters, tmp_path / '导出')
    data = manifest(result)
    assert [frame['name'] for frame in data['frames']] == ['0.5s.png', '1s.png', '1.5s.png']
    expected = decoded(fixtures['cfr'])
    for record in data['frames']:
        timestamp, image = min(expected, key=lambda pair: (abs(pair[0] - record['target']), pair[0]))
        assert record['actual'] == pytest.approx(timestamp)
        with Image.open(record['path']) as saved:
            assert saved.size == (320, 180)
            assert ImageChops.difference(saved.convert('RGB'), image).getbbox() is None
    for _, image in expected: image.close()
    assert Path(result['folder']).name == '测试视频'

def test_variable_frame_rate_uses_actual_timestamps_not_average_fps(processor, fixtures, parameters, tmp_path):
    result = run(processor, fixtures['vfr'], parameters, tmp_path / 'output')
    expected = decoded(fixtures['vfr'])
    assert len({round(expected[i + 1][0] - expected[i][0], 2) for i in range(len(expected) - 1)}) > 1
    for record in manifest(result)['frames']:
        timestamp, image = min(expected, key=lambda pair: (abs(pair[0] - record['target']), pair[0]))
        assert record['actual'] == pytest.approx(timestamp)
        with Image.open(record['path']) as saved:
            assert ImageChops.difference(saved.convert('RGB'), image).getbbox() is None
    for _, image in expected: image.close()

def test_repeat_export_keeps_verified_files_and_parameter_conflict_keeps_registry(processor, fixtures, parameters, tmp_path):
    first = run(processor, fixtures['cfr'], parameters, tmp_path / 'output', 'first')
    stamps = {p.name: p.stat().st_mtime_ns for p in Path(first['folder']).glob('*.png')}
    second = run(processor, fixtures['cfr'], parameters, tmp_path / 'output', 'second')
    assert second['count'] == 3
    assert stamps == {p.name: p.stat().st_mtime_ns for p in Path(first['folder']).glob('*.png')}
    registry = Path(first['folder']) / '.framepick-frames.json'
    previous = registry.read_bytes()
    with pytest.raises(ProcessingError, match='来源或参数'):
        run(processor, fixtures['cfr'], {**parameters, 'maxWidth': 160}, tmp_path / 'output', 'changed')
    assert registry.read_bytes() == previous
    resumed = run(processor, fixtures['cfr'], parameters, tmp_path / 'output', 'third')
    assert resumed['count'] == 3
    overwrite = run(processor, fixtures['cfr'], {**parameters, 'maxWidth': 160, 'conflict': 'overwrite'}, tmp_path / 'output', 'overwrite')
    with Image.open(manifest(overwrite)['frames'][0]['path']) as image: assert image.size == (160, 90)

def test_same_named_sources_get_separate_folders_and_batch_stays_under_video(processor, fixtures, parameters, tmp_path):
    first = run(processor, fixtures['cfr'], parameters, tmp_path / 'output', 'one', name='同名视频')
    second = run(processor, fixtures['vfr'], parameters, tmp_path / 'output', 'two', name='同名视频')
    assert first['folder'] != second['folder']
    batch = run(processor, fixtures['cfr'], {**parameters, 'conflict': 'batch'}, tmp_path / 'output', 'batch', name='同名视频')
    assert Path(batch['folder']).parent == Path(first['folder'])
    assert safe_name('CON') == '_CON'
    assert safe_name('视频:A/B?') == '视频_A_B_'

def test_cancel_preserves_valid_completed_frames_and_retry_reuses_them(processor, fixtures, parameters, tmp_path):
    cancel = threading.Event()
    seen = []
    def progress(event):
        seen.append(event)
        if event.get('stage') == '抽取图片' and event.get('completed', 0) >= 1: cancel.set()
    settings = {**parameters, 'interval': .1}
    with pytest.raises(Cancelled): run(processor, fixtures['long'], settings, tmp_path / 'output', 'cancel', progress, cancel)
    file = tmp_path / 'output/测试视频/任务记录/cancel.json'
    cancelled = json.loads(file.read_text(encoding='utf-8'))
    assert cancelled['status'] == 'cancelled' and len(cancelled['frames']) == 1
    path = Path(cancelled['frames'][0]['path'])
    stamp = path.stat().st_mtime_ns
    with Image.open(path) as image: image.verify()
    assert not list((tmp_path / 'output').rglob('*.part'))
    result = run(processor, fixtures['long'], settings, tmp_path / 'output', 'retry')
    assert result['count'] == 99
    assert path.stat().st_mtime_ns == stamp

@pytest.mark.parametrize('layout', ['grid', 'horizontal', 'vertical'])
def test_composition_keeps_frames_and_splits_pages(processor, fixtures, parameters, tmp_path, layout):
    result = run(processor, fixtures['cfr'], {**parameters, 'autoStitch': True, 'layout': layout}, tmp_path / 'output')
    data = manifest(result)
    assert len(data['frames']) == 3 and len(result['sheets']) == 2
    for record in data['frames']: assert Path(record['path']).is_file()
    for sheet in result['sheets']:
        with Image.open(sheet) as image:
            assert image.width * image.height <= 24_000_000
            image.verify()
    selected = processor.stitch_manifest(result['manifest'], ['1s.png'], parameters, threading.Event(), lambda event: None)
    assert len(selected['sheets']) == 3

def test_shared_text_links_and_platform_boundaries(processor):
    assert processor.normalize_url('分享内容 https://www.douyin.com/jingxuan?modal_id=12345 打开抖音') == 'https://www.douyin.com/video/12345'
    assert processor.normalize_url('https://www.bilibili.com/video/BVxxx?p=2') .endswith('?p=2')
    with pytest.raises(ProcessingError): processor.normalize_url('https://bilibili.com.example.org/video/xxx')

def test_probe_has_required_fields_and_invalid_source_does_not_create_output(processor, fixtures, parameters, tmp_path):
    info = processor.probe(fixtures['cfr'])
    assert info['codec'] == 'ffv1' and info['format'] == 'matroska,webm'
    assert info['audioCodec'] == '无音轨' and info['size'] > 0 and Path(info['thumbnail']).is_file()
    with pytest.raises(ProcessingError): run(processor, tmp_path / 'missing.mp4', parameters, tmp_path / 'not-created')
    assert not (tmp_path / 'not-created').exists()

def test_download_finds_complete_file_when_external_path_encoding_is_garbled(processor, parameters, monkeypatch):
    def fake_download(args, *unused, **options):
        template = Path(args[args.index('-o') + 1])
        template.with_name('video.mp4').write_bytes(b'complete download')
        template.with_name('video.f100.mp4').write_bytes(b'incomplete separate stream')
        template.with_name('video.mp4.part').write_bytes(b'incomplete download')
        return 'FRAMEPICK_FILE:C:/garbled-\ufffd-path/video.mp4\n'
    monkeypatch.setattr(processor, 'run', fake_download)
    file, directory = processor.download({'url': 'https://www.bilibili.com/video/test'}, parameters, threading.Event(), lambda event: None)
    assert file == directory / 'video.mp4'
    assert file.read_bytes() == b'complete download'

def test_video_duration_does_not_extend_to_longer_audio_track(processor, fixtures, parameters, tmp_path):
    info = processor.probe(fixtures['audio_longer'])
    assert info['duration'] == pytest.approx(1)
    assert info['codec'] == 'h264' and info['audioCodec'] == 'aac'
    result = run(processor, fixtures['audio_longer'], parameters, tmp_path / 'output')
    assert result['count'] == 1

@pytest.mark.skipif(os.name != 'nt', reason='Windows process-tree behavior')
def test_tool_timeout_terminates_descendant_and_releases_pipes(processor, tmp_path):
    pid_file = tmp_path / 'child.pid'
    program = ('import subprocess, sys, time; from pathlib import Path; '
               'p = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"], creationflags=subprocess.CREATE_NO_WINDOW); '
               f'Path({str(pid_file)!r}).write_text(str(p.pid)); time.sleep(60)')
    begin = time.monotonic()
    with pytest.raises(ProcessingError, match='超时'):
        processor.run([sys.executable, '-c', program], timeout=1)
    assert time.monotonic() - begin < 8
    assert pid_file.exists()
    handle = ctypes.windll.kernel32.OpenProcess(0x1000, False, int(pid_file.read_text()))
    if handle:
        status = ctypes.c_ulong()
        ctypes.windll.kernel32.GetExitCodeProcess(handle, ctypes.byref(status))
        ctypes.windll.kernel32.CloseHandle(handle)
        assert status.value != 259  # STILL_ACTIVE

@pytest.mark.parametrize('kind', ['rotated', 'hevc'])
def test_rotated_mov_and_hevc_match_decoded_pixels(processor, fixtures, parameters, tmp_path, kind):
    source = fixtures[kind]
    info = processor.probe(source)
    if kind == 'rotated': assert abs(info['rotation']) == 90
    else: assert info['codec'] == 'hevc'
    result = run(processor, source, {**parameters, 'interval': .125, 'start': .25, 'end': .8}, tmp_path / 'output')
    expected = decoded(source)
    for record in manifest(result)['frames']:
        timestamp, raw = min(expected, key=lambda pair: (abs(pair[0] - record['target']), pair[0]))
        image = raw.rotate(info['rotation'], expand=True) if info['rotation'] else raw.copy()
        with Image.open(record['path']) as saved:
            assert record['actual'] == pytest.approx(timestamp)
            assert saved.size == ((90, 160) if kind == 'rotated' else (160, 90))
            assert ImageChops.difference(saved.convert('RGB'), image).getbbox() is None
        image.close()
    for _, image in expected: image.close()
