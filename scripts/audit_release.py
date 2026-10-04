"""Audit release files against locally supplied private terms; never print the terms themselves."""
import json
import hashlib
import marshal
import os
import re
from pathlib import Path
import types
import zipfile
from PIL import Image
from PyInstaller.archive.readers import CArchiveReader

root = Path(__file__).resolve().parents[1]
version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
release = root / 'release' / version
program = release / 'win-unpacked'
terms = json.loads(os.environ.get('FRAMEPICK_PRIVATE_TERMS_JSON', '[]'))
if not terms or any(not isinstance(term, str) or not term for term in terms):
    raise ValueError('Supply a nonempty JSON list in FRAMEPICK_PRIVATE_TERMS_JSON locally.')
needles = [term.encode(encoding) for term in terms for encoding in ('utf-8', 'utf-16le')]
findings = []
objects = 0
secret_patterns=[rb'gh[pousr]_[A-Za-z0-9]{30,}',rb'github_pat_[A-Za-z0-9_]{40,}',rb'AKIA[A-Z0-9]{16}',rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----']
secret_findings=0

def check_bytes(data, location):
    if any(needle in data for needle in needles):
        findings.append(location)

def check_file(file, location):
    overlap = max(map(len, needles)) - 1
    previous = b''
    with file.open('rb') as stream:
        while chunk := stream.read(4 * 1024 * 1024):
            check_bytes(previous + chunk, location)
            previous = chunk[-overlap:]

def code(value, location):
    global objects
    if isinstance(value, types.CodeType):
        objects += 1
        check_bytes(value.co_filename.encode('utf-8'), location)
        for constant in value.co_consts:
            code(constant, location)
    elif isinstance(value, str):
        check_bytes(value.encode('utf-8'), location)
    elif isinstance(value, bytes):
        check_bytes(value, location)
    elif isinstance(value, (tuple, list, set, frozenset)):
        for part in value:
            code(part, location)

def frozen(file):
    archive = CArchiveReader(str(file))
    for name, entry in archive.toc.items():
        kind = entry[-1]
        if kind == 's':
            code(marshal.loads(archive.extract(name)), file.name + ':' + name)
        elif kind == 'z':
            embedded = archive.open_embedded_archive(name)
            for module in embedded.toc:
                code(embedded.extract(module), file.name + ':' + module)

archive_path = release / f'Framepick-Source-{version}.zip'
with zipfile.ZipFile(archive_path) as archive:
    if archive.testzip():
        raise ValueError('Source archive integrity failed.')
    entries = archive.namelist()
    for name in entries:
        data=archive.read(name)
        check_bytes(data, 'source:' + name)
        if any(re.search(pattern,data) for pattern in secret_patterns):
            secret_findings+=1;findings.append('source:'+name)
    if json.loads(archive.read('package.json'))['version'] != version:
        raise ValueError('Source version mismatch.')
    required = [file.relative_to(root).as_posix() for folder in ('src', 'backend', 'tests') for file in (root / folder).rglob('*') if file.is_file() and '__pycache__' not in file.parts and file.suffix != '.pyc']
    if set(required) - set(entries):
        raise ValueError('Source archive is missing application or test files.')

files = [file for file in program.rglob('*') if file.is_file()]
for file in files:
    check_file(file, 'program:' + file.relative_to(program).as_posix())
for file in [program / 'resources/worker/framepick-worker.exe', program / 'resources/tools/yt-dlp.exe']:
    frozen(file)
with zipfile.ZipFile(program / 'resources/worker/_internal/base_library.zip') as library:
    for name in library.namelist():
        if name.endswith('.pyc'):
            code(marshal.loads(library.read(name)[16:]), 'python-base:' + name)
check_file(release / f'Framepick-Setup-{version}.exe', 'installer')
payload=root / '.test-artifacts' / version / 'installer-check/payload'
identical=0
if payload.exists():
    expected={file.relative_to(program).as_posix():file for file in files}
    extracted={file.relative_to(payload).as_posix():file for file in payload.rglob('*') if file.is_file()}
    if set(expected)!=set(extracted):
        raise ValueError('Installer payload file list differs from tested program.')
    for name,file in expected.items():
        with file.open('rb') as original,extracted[name].open('rb') as copy:
            if hashlib.file_digest(original,'sha256').digest()!=hashlib.file_digest(copy,'sha256').digest():
                raise ValueError('Installer payload differs from tested program: '+name)
        identical+=1

images = list((root / 'docs/images').glob('*0.7.1.png'))
for file in images:
    with Image.open(file) as picture:
        if picture.info or picture.getexif():
            raise ValueError('Public screenshot contains metadata: ' + file.name)

report = {'version': version, 'sourceArchiveEntries': len(entries), 'unpackedFilesScanned': len(files), 'embeddedCodeObjectsScanned': objects, 'privateLiteralFindings': len(set(findings)), 'commonSecretPatternFindings':secret_findings,'screenshotMetadataFilesChecked': len(images), 'installerPayloadFilesIdentical':identical,'scope': 'Source ZIP, complete unpacked program, compressed Python code filenames/constants and installer; supplied private references and common source credential patterns only. Screenshots also require visual review.'}
(root / 'docs' / f'隐私核对-{version}.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report))
if findings:
    print(json.dumps({'findingLocations': sorted(set(findings))}))
    raise SystemExit(1)
