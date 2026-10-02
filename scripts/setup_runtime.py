"""Prepare project-local tools. Does not alter the system installation."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import urllib.request
import venv
import zipfile

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / '.tools'
CACHE = ROOT / '.downloads'
UPSTREAM = '4f34810f41f38776a560a293c54a98057e178863'
HEADERS = {'User-Agent': 'Framepick-setup/0.1'}

def fetch(url, target):
    target = Path(target)
    if target.exists():
        return target
    print('Downloading:', target.name, flush=True)
    request = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(request, timeout=180) as response, target.with_suffix(target.suffix + '.part').open('wb') as output:
        shutil.copyfileobj(response, output)
    target.with_suffix(target.suffix + '.part').replace(target)
    return target

def run(args):
    subprocess.run(args, cwd=ROOT, check=True, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))

def main():
    TOOLS.mkdir(exist_ok=True)
    CACHE.mkdir(exist_ok=True)
    env = ROOT / '.venv'
    python = env / 'Scripts/python.exe'
    if not python.exists():
        venv.create(env, with_pip=True)
    run([str(python), '-m', 'pip', 'install', '-r', str(ROOT / 'backend/requirements.txt'), '--disable-pip-version-check'])
    if not all((TOOLS / name).is_file() for name in ('ffmpeg.exe', 'ffprobe.exe', 'yt-dlp.exe')):
        filename = 'Framepick-Runtime-Tools-0.6.1.zip'
        url = 'https://github.com/xiaoweigen/shizhen/releases/download/v0.6.1/' + filename
        archive = fetch(url, CACHE / filename)
        expected = '12a86dbd05f0b600555dc6acd78a527959f2ac1342dfa51209f161d1c125ae04'
        with archive.open('rb') as source:
            if hashlib.file_digest(source, 'sha256').hexdigest() != expected:
                raise RuntimeError('Runtime checksum mismatch; remove the cached archive and try again.')
        with zipfile.ZipFile(archive) as zipped:
            for member in zipped.infolist():
                target = (TOOLS / member.filename).resolve()
                if not target.is_relative_to(TOOLS.resolve()):
                    raise RuntimeError('Unsafe runtime archive path.')
                if member.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with zipped.open(member) as source, target.open('wb') as output:
                        shutil.copyfileobj(source, output)
    vendor = ROOT / 'backend/vendor/video_mosaic'
    vendor.mkdir(parents=True, exist_ok=True)
    for name in ('__init__.py', 'mosaic.py', 'utils.py', 'filters.py'):
        fetch('https://raw.githubusercontent.com/GonzaloFuentes28/video-mosaic/' + UPSTREAM + '/src/video_mosaic/' + name, vendor / name)
    fetch('https://raw.githubusercontent.com/GonzaloFuentes28/video-mosaic/' + UPSTREAM + '/LICENSE', vendor / 'LICENSE')
    (TOOLS / 'versions.json').write_text(json.dumps({'ffmpeg': '9.0.2 Framepick GPLv3+ (x264/x265/zimg)', 'ytDlp': '2026.08.19', 'videoMosaicCommit': UPSTREAM}, indent=2), encoding='utf-8')
    print('Project runtime ready.', flush=True)

if __name__ == '__main__':
    main()
