import os
import shutil
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
subprocess.run([sys.executable, str(root / 'scripts/collect_licenses.py')], cwd=root, check=True, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
subprocess.run([
    sys.executable, '-m', 'PyInstaller', '--noconfirm', '--clean', '--onedir', '--console',
    '--name', 'framepick-worker', '--distpath', str(root / 'runtime'), '--workpath', str(root / 'build/worker'),
    '--specpath', str(root / 'build'), '--paths', str(root / 'backend'), '--paths', str(root / 'backend/vendor'),
    '--collect-all', 'av', '--collect-submodules', 'PIL', str(root / 'backend/worker.py')
], cwd=root, check=True, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
# Only metadata caches are removed; compiled runtime modules remain intact.
internal = root / 'runtime/framepick-worker/_internal'
for metadata in internal.glob('*.dist-info'):
    for cache in metadata.rglob('__pycache__'):
        shutil.rmtree(cache)
