"""Playable previews and precise, non-destructive video segment exports."""
from pathlib import Path
import hashlib
import math
import shutil
import time
import uuid


def validate_ranges(ranges, duration):
    if not isinstance(ranges, list) or not 1 <= len(ranges) <= 100:
        raise ValueError('请保留 1～100 个视频时段。')
    cleaned = []
    for item in ranges:
        if not isinstance(item, dict): raise ValueError('视频时段格式无效。')
        a, b = item.get('start'), item.get('end')
        if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in (a, b)):
            raise ValueError('视频时间无效。')
        if a < 0 or b <= a or b > duration + .001: raise ValueError('视频时段超出时长或结束早于开始。')
        cleaned.append({'start': a, 'end': min(b, duration)})
    cleaned.sort(key=lambda r: r['start'])
    if any(cleaned[i]['start'] < cleaned[i-1]['end'] - 1e-8 for i in range(1, len(cleaned))):
        raise ValueError('视频时段不能重叠。')
    return cleaned


def _source(p, video, settings, cancel, emit, preview=False):
    for key in (('downloadedPath',) if video.get('source') == 'online' else ('path',)):
        source = Path(video[key]) if video.get(key) else None
        if source and source.is_file(): return source.resolve(), None
    if video.get('source') != 'online': raise ValueError('视频文件不存在，请重新定位。')
    raise ValueError('已保存的视频不存在，请先下载到保存文件夹或重新定位。不会自动重新下载。')


def _encode(p, source, destination, info, ranges, cancel, progress, preview=False):
    if info.get('codec')=='av1':
        from av_encoder import encode
        return encode(source,destination,info,ranges,cancel,progress,preview)
    audio=info.get('audioCodec') not in (None,'','无音轨')
    args=[p.tool('ffmpeg'),'-hide_banner','-loglevel','error','-nostdin','-y']
    # Separate seeked inputs decode each retained interval, including exact non-keyframe cuts.
    for r in ranges: args += ['-ss',str(r['start']),'-t',str(r['end']-r['start']),'-i',str(source)]
    filters=[];mapped=[]
    for i,r in enumerate(ranges):
        filters.append(f'[{i}:v:0]setpts=PTS-STARTPTS[v{i}]');mapped.append(f'[v{i}]')
        if audio:
            span=r['end']-r['start']
            filters.append(f'[{i}:a:0]asetpts=PTS-STARTPTS,apad,atrim=duration={span}[a{i}]');mapped.append(f'[a{i}]')
    filters.append(''.join(mapped)+f'concat=n={len(ranges)}:v=1:a={int(audio)}[joinedv]'+('[joineda]' if audio else ''))
    scale="scale='min(960,iw)':-2" if preview else 'scale=trunc(iw/2)*2:trunc(ih/2)*2'
    filters.append(f'[joinedv]scale=trunc(iw*sar/2)*2:trunc(ih/2)*2,setsar=1,{scale}[vout]')
    args += ['-filter_complex',';'.join(filters),'-map','[vout]']
    if audio: args += ['-map','[joineda]','-c:a','aac','-b:a','128k']
    args += ['-c:v','libx264','-preset','veryfast','-crf','25' if preview else '18','-pix_fmt','yuv420p','-threads','2','-map_metadata','-1','-movflags','+faststart','-progress','pipe:1','-f','mp4',str(destination)]
    total=sum(r['end']-r['start'] for r in ranges)
    def report(line):
        if line.startswith('out_time_us='):
            try: progress(min(.99,max(0,int(line.split('=')[1])/1000000/total)))
            except ValueError: pass
    p.run(args,cancel,timeout=max(300,total*20),progress=report)


def prepare_preview(p, video, settings, cancel, emit, force=False):
    from core import check_cancel
    source,directory=_source(p,video,settings,cancel,emit,True)
    working=None
    try:
        check_cancel(cancel)
        if not force: return {'path':str(source),'source':str(source),'converted':False}
        info=p.probe(source,False);check_cancel(cancel)
        cache=p.cache/'playback';cache.mkdir(exist_ok=True)
        key=hashlib.sha256(f'{source.resolve()}:{source.stat().st_size}:{source.stat().st_mtime_ns}'.encode()).hexdigest()
        dest=cache/(key+'.mp4')
        if not dest.is_file():
            working=cache/(key+'.'+uuid.uuid4().hex+'.part')
            emit({'stage':'生成可播放预览','progress':20})
            _encode(p,source,working,info,[{'start':0,'end':info['duration']}],cancel,lambda f:emit({'stage':'生成可播放预览','progress':20+f*79}),True)
            check_cancel(cancel);working.replace(dest)
        return {'path':str(dest),'source':str(source),'converted':True}
    finally:
        if working: working.unlink(missing_ok=True)
        if directory: p.remove_cache(directory)


def trim_video(p, video, settings, output_root, ranges, join, cancel, emit):
    from core import check_cancel, safe_name
    started=time.monotonic();root=Path(output_root).resolve();root.mkdir(parents=True,exist_ok=True)
    source,directory=_source(p,video,settings,cancel,emit)
    reserved=[];partials=[];completed=False
    try:
        info=p.probe(source,False);ranges=validate_ranges(ranges,info['duration'])
        groups=[ranges] if join else [[r] for r in ranges]
        total=sum(r['end']-r['start'] for r in ranges);processed=0
        if shutil.disk_usage(root).free<max(32*1024*1024,source.stat().st_size*sum(r['end']-r['start'] for r in ranges)/info['duration']*1.5):
            raise ValueError('剪切保存位置的空间不足。')
        for index, group in enumerate(groups):
            check_cancel(cancel)
            stem=safe_name(video['name'])+(' · 剪切' if join or len(groups)==1 else f' · 片段{index+1:02d}')
            dest=None
            for duplicate in range(10000):
                candidate=root/(stem+(f' ({duplicate+1})' if duplicate else '')+'.mp4')
                try:
                    with candidate.open('xb'): pass
                    dest=candidate;reserved.append(dest);break
                except FileExistsError: continue
            if dest is None: raise ValueError('同名文件过多，请更换保存文件夹。')
            part=root/('.framepick-trim-'+uuid.uuid4().hex+'.part');partials.append(part)
            span=sum(r['end']-r['start'] for r in group)
            emit({'stage':f'剪切视频 {index+1}/{len(groups)}','total':len(groups),'completed':index})
            def progress(f): emit({'stage':f'剪切视频 {index+1}/{len(groups)}','progress':(processed+f*span)/total*99})
            _encode(p,source,part,info,group,cancel,progress)
            check_cancel(cancel);p.probe(part,False);processed+=span
        # Commit only after every output has been verified; cancellation removes this run's files.
        check_cancel(cancel)
        for part,dest in zip(partials,reserved): part.replace(dest)
        completed=True
        return {'outputFiles':[str(p) for p in reserved],'folder':str(root),'count':len(reserved),'completed':len(reserved),'total':len(reserved),'elapsed':round(time.monotonic()-started,2)}
    finally:
        for part in partials: part.unlink(missing_ok=True)
        if not completed:
            for dest in reserved: dest.unlink(missing_ok=True)
        if directory: p.remove_cache(directory)
