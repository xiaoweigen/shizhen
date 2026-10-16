"""Headless Framepick entry for an audio sampling-plan JSON; no audio-core or UI import."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import threading
import uuid
from core import Processor, ProcessingError, target_times


def file_hash(file):
    digest=hashlib.sha256()
    with file.open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''):digest.update(block)
    return 'sha256:'+digest.hexdigest()


def execute(source,plan_file,output,settings_file=None,tools=None):
    source=Path(source).resolve(strict=True);plan_file=Path(plan_file).resolve(strict=True)
    if not source.is_file() or plan_file.stat().st_size>16*1024*1024:
        raise ProcessingError('请选择本地视频和不超过16MB的采样计划。')
    plan=json.loads(plan_file.read_text('utf-8-sig'))
    if not isinstance(plan,dict) or plan.get('time_unit')!='ms' or not isinstance(plan.get('settings'),dict):
        raise ProcessingError('采样计划必须含 time_unit=ms、settings.times 和 source_media_id。')
    identity=file_hash(source)
    if plan.get('source_media_id')!=identity:
        raise ProcessingError('采样计划与当前视频的 SHA256 不一致，不会用其他媒体的时刻误抽帧。')
    settings={'interval':1,'format':'jpg','quality':92,'maxWidth':640,'conflict':'batch','autoStitch':False,'hdrMode':'auto','deduplicate':False}
    if settings_file:
        options=json.loads(Path(settings_file).read_text('utf-8-sig'))
        if not isinstance(options,dict):raise ProcessingError('附加设置必须是JSON对象。')
        settings.update(options)
    settings['times']=plan['settings'].get('times')
    project=Path(__file__).resolve().parents[1]
    processor=Processor(str(Path(tools) if tools else project/'.tools'),str(Path(output).resolve()/'.framepick-plan-cache'))
    info=processor.probe(source)
    times=target_times(info['duration'],settings)
    # Preserve distinct requested times, even if several select the same decoded frame.
    # Average FPS cannot identify native frames, especially for variable-rate media.
    result=processor.process({'path':str(source),'name':source.stem,'source':'local'},settings,str(output),threading.Event(),lambda e:None,'plan-'+uuid.uuid4().hex)
    if file_hash(source)!=identity:raise ProcessingError('处理期间原视频发生变化，请重新核验。')
    return {**result,'source_media_id':identity,'plan_id':plan.get('plan_id'),'time_unit':'ms','actual_time_unit':'seconds','times_requested':len(times),'times_collapsed':0}


def main():
    if hasattr(sys.stdout,'reconfigure'):sys.stdout.reconfigure(encoding='utf-8')
    parser=argparse.ArgumentParser(description='从音频采样计划执行拾帧，无需启动Electron或音频进程')
    parser.add_argument('--video',required=True);parser.add_argument('--plan',required=True);parser.add_argument('--output',required=True)
    parser.add_argument('--settings',help='可选JSON，复用裁剪/HDR/拼图等后端设置，times仍以计划为准')
    parser.add_argument('--tools',help='可选FFmpeg工具目录')
    args=parser.parse_args()
    try:
        print(json.dumps(execute(args.video,args.plan,args.output,args.settings,args.tools),ensure_ascii=False))
    except (OSError,ValueError,ProcessingError) as error:
        print(json.dumps({'status':'error','error':str(error)},ensure_ascii=False),file=sys.stderr)
        raise SystemExit(1)


if __name__=='__main__':main()
