"""Build a minimal yt-dlp executable with CPython and no optional native dependencies."""
from pathlib import Path
import subprocess
import sys
import venv

root = Path(__file__).resolve().parents[1]
environment = root / 'build/decoder-env'
python = environment / 'Scripts/python.exe'
flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
if not python.exists():
    venv.create(environment, with_pip=True)
subprocess.run([str(python), '-m', 'pip', 'install', 'yt-dlp==2026.08.19', 'pyinstaller==6.22.3', 'certifi==2026.7.22'], check=True, creationflags=flags)
entry = root / 'build/decoder_entry.py'
entry.write_text('import yt_dlp\nif __name__ == "__main__":\n    yt_dlp.main()\n', encoding='utf-8')
subprocess.run([str(python), '-m', 'PyInstaller', '--noconfirm', '--clean', '--onefile', '--console',
                '--name', 'yt-dlp', '--distpath', str(root / '.tools'), '--workpath', str(root / 'build/decoder'),
                '--specpath', str(root / 'build'), '--collect-all', 'yt_dlp', '--collect-data', 'certifi',
                str(entry)], check=True, creationflags=flags)
