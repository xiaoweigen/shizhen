"""JSON-lines worker; independent cancellable requests, with stdout reserved for the protocol."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import sys
import threading
import traceback

from core import Processor, Cancelled

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)
    sys.stdin.reconfigure(encoding='utf-8')

parser = argparse.ArgumentParser()
parser.add_argument('--tools', required=True)
parser.add_argument('--cache', required=True)
args = parser.parse_args()
processor = Processor(args.tools, args.cache)
write_lock = threading.Lock()
active_lock = threading.Lock()
active = {}

def send(value):
    with write_lock:
        print(json.dumps(value, ensure_ascii=False), flush=True)

def handle(request, cancel):
    identity = request['id']
    params = request.get('params', {})
    def event(data):
        send({'event': 'progress', 'id': identity, 'data': data})
    try:
        method = request['method']
        if method == 'health':
            result = processor.health()
        elif method == 'probe':
            result = processor.probe(params['path'])
        elif method == 'thumbnails':
            result = processor.thumbnails(params['files'])
        elif method == 'decoder-version':
            result = {'version': processor.run([processor.tool('yt-dlp'), '--version']).strip(), 'path': processor.tool('yt-dlp')}
        elif method == 'verify-decoder':
            version = processor.run([params['path'], '--version']).strip()
            if params.get('version') and version != params['version']:
                raise ValueError('解析器版本校验失败。')
            result = {'version': version}
        elif method == 'use-decoder':
            processor.run([params['path'], '--version'])
            processor.decoder = params['path']
            result = {'ready': True}
        elif method == 'resolve':
            result = processor.resolve(params['text'], params['settings'], cancel, params.get('guestCookies'))
        elif method == 'process':
            result = processor.process(params['video'], params['settings'], params['outputRoot'], cancel, event, params['jobId'], params.get('resumeFolder'))
        elif method == 'download-video':
            result = processor.download_video(params['video'], params['settings'], params['outputRoot'], cancel, event)
        elif method == 'prepare-preview':
            from video_editing import prepare_preview
            result = prepare_preview(processor, params['video'], params['settings'], cancel, event, params.get('force', False))
        elif method == 'trim-video':
            from video_editing import trim_video
            result = trim_video(processor, params['video'], params['settings'], params['outputRoot'], params['ranges'], params['join'], cancel, event)
        elif method == 'stitch':
            result = processor.stitch_manifest(params['manifest'], params.get('names', []), params['settings'], cancel, event, params.get('page'), params.get('offset', 0))
        elif method == 'stitch-preview':
            result = processor.preview_manifest(params['manifest'], params.get('names', []), params['settings'], params.get('page', 0), params.get('notes'), params.get('offset', 0))
        elif method == 'save-stitch-draft':
            result = processor.save_stitch_draft(params['manifest'], params.get('notes', {}), params['settings'])
        else:
            raise ValueError('未知操作。')
        send({'id': identity, 'result': result})
    except BaseException as error:
        send({'id': identity, 'error': str(error), 'cancelled': isinstance(error, Cancelled)})
        if not isinstance(error, Cancelled):
            traceback.print_exc(file=sys.stderr)
    finally:
        with active_lock:
            active.pop(identity, None)

with ThreadPoolExecutor(max_workers=2) as pool:
    for line in sys.stdin:
        try:
            request = json.loads(line)
            if request.get('method') == 'cancel':
                with active_lock:
                    token = active.get(request.get('target'))
                if token:
                    token.set()
                continue
            cancel = threading.Event()
            with active_lock:
                active[request['id']] = cancel
            pool.submit(handle, request, cancel)
        except (ValueError, KeyError):
            send({'error': '无效请求。'})
    with active_lock:
        for token in active.values():
            token.set()
