import os
from pathlib import Path
import subprocess
import sys

import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
from core import Processor

@pytest.fixture(scope='session')
def fixtures(tmp_path_factory):
    folder = tmp_path_factory.mktemp('videos')
    ffmpeg = ROOT / '.tools/ffmpeg.exe'
    def run(args):
        subprocess.run([str(ffmpeg), '-hide_banner', '-loglevel', 'error', '-y', *args], check=True, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    cfr = folder / '测试视频.mkv'
    run(['-f', 'lavfi', '-i', 'testsrc2=duration=2:size=320x180:rate=10', '-c:v', 'ffv1', str(cfr)])
    images = []
    for index, color in enumerate(['red', 'green', 'blue', 'yellow']):
        file = folder / f'{index}.png'
        Image.new('RGB', (160, 90), color).save(file)
        images.append(file)
    concat = folder / 'concat.txt'
    durations = [.12, .88, .08, .92]
    concat.write_text('\n'.join(f"file '{file.as_posix()}'\nduration {duration}" for file, duration in zip(images, durations)) + f"\nfile '{images[-1].as_posix()}'\n", encoding='utf-8')
    vfr = folder / '可变帧率.mkv'
    run(['-f', 'concat', '-safe', '0', '-i', str(concat), '-fps_mode', 'vfr', '-c:v', 'ffv1', str(vfr)])
    long = folder / '长任务.mkv'
    run(['-f', 'lavfi', '-i', 'testsrc2=duration=10:size=320x180:rate=30', '-c:v', 'ffv1', str(long)])
    audio_longer = folder / '音频更长.mp4'
    run(['-f', 'lavfi', '-i', 'testsrc2=duration=1:size=160x90:rate=10', '-f', 'lavfi', '-i', 'sine=duration=3', '-c:v', 'libx264', '-threads', '2', '-c:a', 'aac', str(audio_longer)])
    rotated = folder / '旋转视频.mov'
    run(['-display_rotation', '90', '-i', str(audio_longer), '-c', 'copy', str(rotated)])
    hevc = folder / 'HEVC.mkv'
    run(['-f', 'lavfi', '-i', 'testsrc2=duration=1:size=160x90:rate=10', '-c:v', 'libx265', '-x265-params', 'pools=1:frame-threads=1:log-level=error', str(hevc)])
    return {'cfr': cfr, 'vfr': vfr, 'long': long, 'audio_longer': audio_longer, 'rotated': rotated, 'hevc': hevc}

@pytest.fixture
def processor(tmp_path):
    return Processor(str(ROOT / '.tools'), str(tmp_path / 'cache'))

@pytest.fixture
def parameters():
    return {'interval': .5, 'start': 0, 'end': None, 'includeStart': False, 'format': 'png', 'quality': 92, 'maxWidth': None,
            'conflict': 'skip', 'autoStitch': False, 'layout': 'grid', 'columns': 2, 'perSheet': 2, 'thumbWidth': 240,
            'padding': 4, 'labels': True, 'background': '#182c26', 'onlineQuality': 360, 'cookiePath': '', 'keepDownload': False}
