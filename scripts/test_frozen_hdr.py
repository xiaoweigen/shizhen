"""Validate the distributed worker's HDR mapping against independent FFmpeg output."""
import json
import os
from pathlib import Path
import subprocess
import time
from PIL import Image, ImageChops, ImageStat

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
ARTIFACT = ROOT / '.test-artifacts' / VERSION / 'frozen-hdr' / str(round(time.time() * 1000))
RESOURCES = ROOT / 'release' / VERSION / 'win-unpacked' / 'resources'
TOOLS = RESOURCES / 'tools'
ARTIFACT.mkdir(parents=True)
FLAGS = getattr(subprocess, 'CREATE_NO_WINDOW', 0) | getattr(subprocess, 'BELOW_NORMAL_PRIORITY_CLASS', 0)
env = {**os.environ, 'PATH': os.path.join(os.environ['SystemRoot'], 'System32') + ';' + os.environ['SystemRoot']}
log = (ARTIFACT / 'worker-errors.log').open('w', encoding='utf-8')
worker = subprocess.Popen([str(RESOURCES / 'worker/framepick-worker.exe'), '--tools', str(TOOLS), '--cache', str(ARTIFACT / 'cache')], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=log, text=True, encoding='utf-8', env=env, creationflags=FLAGS)

def request(method, params):
    identity = str(time.time_ns())
    worker.stdin.write(json.dumps({'id': identity, 'method': method, 'params': params}) + '\n')
    worker.stdin.flush()
    while True:
        line = worker.stdout.readline()
        if not line:
            raise RuntimeError('Distributed worker stopped')
        message = json.loads(line)
        if message.get('event') or message.get('id') != identity:
            continue
        if message.get('error'):
            raise RuntimeError(message['error'])
        return message['result']

settings = {'interval': .5, 'start': 0, 'end': .7, 'includeStart': False, 'format': 'png', 'quality': 92, 'maxWidth': None, 'conflict': 'skip', 'autoStitch': False, 'rows': 3, 'columns': 3, 'perSheet': 9, 'layout': 'grid', 'thumbWidth': 240, 'padding': 8, 'labels': True, 'background': '#182c26', 'notesEnabled': False, 'noteHeight': 96, 'noteFontSize': 14, 'onlineQuality': 360, 'cookiePath': '', 'keepDownload': False, 'crop': None, 'cropSegments': [], 'sampling': 'interval', 'deduplicate': False, 'similarity': 5, 'sceneThreshold': 18, 'hdrMode': 'auto'}
cases = []
try:
    assert request('health', {})['ready']
    for transfer in ['smpte2084', 'arib-std-b67']:
        source = ARTIFACT / (transfer + '.mkv')
        subprocess.run([str(TOOLS / 'ffmpeg.exe'), '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=duration=1:size=160x90:rate=10', '-vf', f'setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709,zscale=p=bt2020:t={transfer}:m=bt2020nc,format=yuv420p10le', '-c:v', 'ffv1', str(source)], check=True, creationflags=FLAGS)
        info = request('probe', {'path': str(source)})
        assert info['hdr'] and info['colorTransfer'] == transfer
        for mode in ['auto', 'hable', 'reinhard', 'off']:
            begin = time.monotonic()
            result = request('process', {'jobId': transfer + '-' + mode, 'video': {'id': transfer, 'source': 'local', 'path': str(source), 'name': transfer}, 'settings': {**settings, 'hdrMode': mode}, 'outputRoot': str(ARTIFACT / mode)})
            record = json.loads(Path(result['manifest']).read_text(encoding='utf-8'))['frames'][0]
            reference = ARTIFACT / f'reference-{transfer}-{mode}.rgb'
            vf = 'format=rgb24' if mode == 'off' else 'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=' + ('hable' if mode == 'auto' else mode) + ':desat=2,zscale=t=bt709:m=bt709:r=full,format=yuv444p,format=rgb24'
            subprocess.run([str(TOOLS / 'ffmpeg.exe'), '-hide_banner', '-loglevel', 'error', '-y', '-i', str(source), '-ss', str(record['actual']), '-vf', vf, '-frames:v', '1', '-c:v', 'rawvideo', '-f', 'rawvideo', str(reference)], check=True, creationflags=FLAGS)
            with Image.open(record['path']) as saved, Image.frombytes('RGB',(160,90),reference.read_bytes()) as expected:
                differences = ImageStat.Stat(ImageChops.difference(saved, expected)).mean
                assert saved.mode == 'RGB' and saved.size == (160, 90) and max(differences) < 1
            cases.append({'transfer': transfer, 'mode': mode, 'status': 'passed', 'meanChannelDifference': differences, 'seconds': round(time.monotonic() - begin, 3)})
    report = {'result': 'passed', 'version': VERSION, 'packagedWorker': True, 'generatedStandardSamples': True, 'cases': cases, 'artifact': str(ARTIFACT)}
    (ARTIFACT / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report), flush=True)
finally:
    worker.stdin.close()
    try:
        worker.wait(timeout=10)
    except subprocess.TimeoutExpired:
        worker.kill()
        worker.wait()
    log.close()
