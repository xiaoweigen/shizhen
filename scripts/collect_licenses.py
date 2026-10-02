"""Copy notices for the exact locally installed components into the distribution."""
from pathlib import Path
import shutil
import sys
from PyInstaller.archive.readers import CArchiveReader

root = Path(__file__).resolve().parents[1]
licenses = root / '.tools/licenses'
licenses.mkdir(exist_ok=True)
archive = CArchiveReader(str(root / '.tools/yt-dlp.exe'))
if 'THIRD_PARTY_LICENSES.txt' in archive.toc:
    (root / '.tools/yt-dlp-THIRD_PARTY_LICENSES.txt').write_bytes(archive.extract('THIRD_PARTY_LICENSES.txt'))
else:
    # Our minimal CPython build has no optional GNU/native downloader dependencies.
    (root / '.tools/yt-dlp-THIRD_PARTY_LICENSES.txt').write_text(
        'Framepick minimal yt-dlp build: yt-dlp 2026.08.19 (Unlicense), '
        'CPython 3.12, certifi 2026.7.22 (MPL-2.0), PyInstaller bootloader exception.\n'
        'See resources/licenses and project-licenses for full notices.\n', encoding='utf-8')
    decoder_site = root / 'build/decoder-env/Lib/site-packages'
    for folder in decoder_site.glob('*.dist-info'):
        for file in folder.rglob('*'):
            if file.is_file() and '__pycache__' not in file.parts and file.name.lower().startswith(('license', 'copying', 'authors')):
                dest = licenses / 'decoder' / folder.name / file.relative_to(folder)
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(file, dest)
    for file in (decoder_site / 'setuptools/_vendor').rglob('*'):
        if file.is_file() and '__pycache__' not in file.parts and file.name.lower().startswith(('license', 'copying')):
            dest = licenses / 'decoder/setuptools-vendor' / file.relative_to(decoder_site / 'setuptools/_vendor')
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(file, dest)
for component in ('av', 'pillow', 'pyinstaller'):
    directory = next((root / '.venv/Lib/site-packages').glob(component + '-*.dist-info'))
    for file in directory.rglob('*'):
        if file.is_file() and '__pycache__' not in file.parts and file.suffix.lower() not in ('.pyc', '.pyo') and ('licenses' in file.parts or 'license' in file.name.lower() or 'copying' in file.name.lower()):
            dest = licenses / component / file.relative_to(directory)
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(file, dest)
python_license = Path(sys.base_prefix) / 'LICENSE.txt'
if python_license.is_file(): shutil.copyfile(python_license, licenses / 'Python-LICENSE.txt')
for component in ('react', 'react-dom', 'antd'):
    for file in (root / 'node_modules' / component).glob('*LICENSE*'):
        shutil.copyfile(file, licenses / (component + '-LICENSE.txt'))
print('Collected third-party notices.', flush=True)

lock = __import__('json').loads((root / 'package-lock.json').read_text(encoding='utf-8'))
entries = []
for name, metadata in lock['packages'].items():
    if not name or metadata.get('dev') or not name.startswith('node_modules/'):
        continue
    package_folder = root / name
    if not package_folder.is_dir():
        raise RuntimeError('Missing production dependency: ' + name)
    relative_name = name.removeprefix('node_modules/')
    notice_names = []
    for file in package_folder.iterdir():
        if file.is_file() and file.name.lower().split('.')[0] in ('license', 'licence', 'copying', 'notice', 'copyright'):
            dest = licenses / 'npm' / relative_name / file.name
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(file, dest)
            notice_names.append(file.name)
    supplements = {'@ant-design/icons-svg': 'Ant-Design-Icons-SVG-MIT.txt', 'is-mobile': 'is-mobile-MIT.txt'}
    if not notice_names and relative_name in supplements:
        file = root / 'licenses' / supplements[relative_name]
        dest = licenses / 'npm' / relative_name / file.name
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(file, dest)
        notice_names.append(file.name)
    if not notice_names:
        raise RuntimeError('No license notice found for dependency: ' + relative_name)
    entries.append({'name': relative_name, 'version': metadata.get('version'), 'license': metadata.get('license'), 'notices': notice_names})
(licenses / 'npm-components.json').write_text(__import__('json').dumps(entries, ensure_ascii=False, indent=2), encoding='utf-8')
