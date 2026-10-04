import json
import subprocess
import threading
from pathlib import Path
from types import SimpleNamespace
import av
import pytest
from PIL import Image, ImageChops, ImageStat
from core import ProcessingError, crop_at, validated_segments
from conftest import ROOT
from test_processing import run, manifest, decoded
import storyboard

def test_temporal_crop_inclusive_gaps_and_pixel_accuracy(processor,fixtures,parameters,tmp_path):
    left={'x':0,'y':0,'width':.5,'height':1}
    top={'x':0,'y':0,'width':1,'height':.5}
    base={'x':.1,'y':.2,'width':.8,'height':.6}
    settings={**parameters,'interval':.1,'crop':base,'cropSegments':[{'id':'a','start':.2,'end':.5,'rect':left},{'id':'b','start':.6,'end':1,'rect':top},{'id':'c','start':1.2,'end':1.4,'rect':None}]}
    result=run(processor,fixtures['cfr'],settings,tmp_path/'segments')
    original=decoded(fixtures['cfr'])
    for record in manifest(result)['frames']:
        time=record['target']
        region=(0,0,160,180) if .2<=time<=.5 else (0,0,320,90) if .6<=time<=1 else (0,0,320,180) if 1.2<=time<=1.4 else (32,36,288,144)
        _,source=min(original,key=lambda pair:(abs(pair[0]-time),pair[0]))
        with source.crop(region) as expected,Image.open(record['path']) as actual:
            assert actual.size==expected.size
            assert ImageChops.difference(actual,expected).getbbox() is None
    for _,image in original:image.close()
    assert crop_at(settings,.5)==left and crop_at(settings,.55)==base and crop_at(settings,.6)==top
    assert crop_at(settings,1.3) is None and crop_at(settings,1.5)==base

def test_temporal_shared_boundary_uses_later_and_overlaps_rejected(processor,fixtures,parameters,tmp_path):
    left={'x':0,'y':0,'width':.5,'height':1}
    segments=[{'id':'a','start':0,'end':1,'rect':left},{'id':'b','start':1,'end':2,'rect':None}]
    assert crop_at({'cropSegments':segments},1) is None
    assert validated_segments({'cropSegments':segments},2)==segments
    for bad in [None,{},'x',{'start':float('nan'),'end':2,'rect':None}]:
        with pytest.raises(ProcessingError): validated_segments({'cropSegments':[bad]},2)
    with pytest.raises(ProcessingError,match='重叠'):
        run(processor,fixtures['cfr'],{**parameters,'cropSegments':[segments[0],{**segments[1],'start':.8}]},tmp_path/'invalid')
    assert not (tmp_path/'invalid').exists()
    with pytest.raises(ProcessingError,match='范围'):
        validated_segments({'cropSegments':[{**segments[1],'end':3}]},2)

def test_temporal_crop_changes_invalidate_skip_and_empty_is_compatible(processor,fixtures,parameters,tmp_path):
    result=run(processor,fixtures['cfr'],parameters,tmp_path/'root')
    same=run(processor,fixtures['cfr'],{**parameters,'cropSegments':[]},tmp_path/'root','empty')
    assert result['folder']==same['folder']
    with pytest.raises(ProcessingError,match='来源或参数'):
        run(processor,fixtures['cfr'],{**parameters,'cropSegments':[{'id':'a','start':0,'end':1,'rect':{'x':0,'y':0,'width':.5,'height':1}}]},tmp_path/'root','changed')

def test_mixed_aspect_storyboard_keeps_images_and_trims_empty_rows(processor,parameters,tmp_path):
    frames=[]
    for index,size in enumerate([(100,100),(200,100),(50,100),(100,100),(200,100)]):
        file=tmp_path/f'{index}.png';Image.new('RGB',size,['red','green','blue','yellow','purple'][index]).save(file)
        frames.append({'name':file.name,'path':str(file),'target':index})
    settings={**parameters,'rows':3,'columns':3,'perSheet':9,'thumbWidth':100,'labels':False,'notesEnabled':True,'noteHeight':40,'background':'#ffffff','noteBackground':'#f0f0f0'}
    geometry=storyboard.plan(frames,settings,{})
    assert geometry['rows']==2 and geometry['imageHeight']==200
    output=tmp_path/'mixed.jpg';storyboard.compose_page(frames,output,settings,geometry,{},0,lambda *_:None)
    with Image.open(output) as image:
        assert image.size==(316,492)
        # Wide green image is centered vertically in the common 100 x 200 slot.
        assert image.getpixel((158,15))[0]>240
        pixel=image.getpixel((158,104));assert pixel[1]>80 and pixel[0]<20
        # The missing last-column cell remains white; there is no third row.
        assert min(image.getpixel((265,350)))>240

def test_disk_space_failure_preserves_existing_images(processor,fixtures,parameters,tmp_path,monkeypatch):
    result=run(processor,fixtures['cfr'],parameters,tmp_path/'disk','first')
    existing={Path(f['path']):Path(f['path']).read_bytes() for f in manifest(result)['frames']}
    monkeypatch.setattr('core.shutil.disk_usage',lambda _:SimpleNamespace(free=1))
    with pytest.raises(ProcessingError,match='空间不足'):
        run(processor,fixtures['cfr'],{**parameters,'conflict':'overwrite'},tmp_path/'disk','lowspace')
    assert all(file.read_bytes()==content for file,content in existing.items())
    assert not list(Path(result['folder']).glob('*.part'))

def test_thumbnail_cache_is_small_reused_and_invalidated(processor,tmp_path):
    file=tmp_path/'large.png';Image.new('RGB',(3840,2160),'red').save(file)
    first=processor.thumbnails([str(file)])[0];cache=Path(first['thumbnail']);stamp=cache.stat().st_mtime_ns
    with Image.open(cache) as image:assert image.size==(480,270)
    assert first['width']==3840 and first['height']==2160
    assert processor.thumbnails([str(file)])[0]['thumbnail']==str(cache) and cache.stat().st_mtime_ns==stamp
    Image.new('RGB',(3840,2160),'blue').save(file)
    assert processor.thumbnails([str(file)])[0]['thumbnail']!=str(cache)
    assert processor.thumbnails([str(tmp_path/'missing.png')])[0]['error']

def test_scene_sampling_and_dedup_keep_explainable_timestamps(processor,fixtures,parameters,tmp_path):
    scenes=run(processor,fixtures['vfr'],{**parameters,'sampling':'scene','interval':.05,'sceneThreshold':10},tmp_path/'scene')
    records=manifest(scenes)['frames']
    assert len(records)==4
    assert [round(f['actual'],2) for f in records]==[0,.12,1,1.08]
    full=run(processor,fixtures['vfr'],{**parameters,'interval':.02},tmp_path/'full')
    dedup=run(processor,fixtures['vfr'],{**parameters,'interval':.02,'deduplicate':True,'similarity':5},tmp_path/'dedup','a')
    assert dedup['count']==4 and full['count']>80
    times=[f['target'] for f in manifest(dedup)['frames']];assert times==sorted(times)
    stamps={f['name']:Path(f['path']).stat().st_mtime_ns for f in manifest(dedup)['frames']}
    retry=run(processor,fixtures['vfr'],{**parameters,'interval':.02,'deduplicate':True,'similarity':5},tmp_path/'dedup','b')
    assert retry['count']==4 and {f['name']:Path(f['path']).stat().st_mtime_ns for f in manifest(retry)['frames']}==stamps

def test_storyboard_order_styles_and_recipe_are_restored(processor,fixtures,parameters,tmp_path):
    result=run(processor,fixtures['cfr'],parameters,tmp_path/'story')
    records=manifest(result)['frames'];names=[f['name'] for f in records][::-1]
    settings={**parameters,'preserveOrder':True,'frameOrder':names,'rows':2,'columns':2,'notesEnabled':True,'noteHeight':60,'noteFontSize':20,'noteColor':'#ff0000','noteBackground':'#f0f0f0','noteAlign':'right','noteFont':'arial'}
    notes={name:'镜号：1\n动作：走向门口\nDialogue: Hello' for name in names}
    processor.save_stitch_draft(result['manifest'],notes,settings)
    preview=processor.preview_manifest(result['manifest'],names,settings)
    assert [f['name'] for f in preview['frames']]==names
    output=processor.stitch_manifest(result['manifest'],names,settings,threading.Event(),lambda *_:None)
    saved=manifest(result);recipe=saved['sheetRecipes'][output['sheets'][-1]]
    assert recipe['names']==names and recipe['settings']['noteAlign']=='right' and recipe['notes']==notes
    with Image.open(output['sheets'][-1]) as image:
        assert image.size==(preview['width'],preview['height'])
        top=preview['padding']+preview['imageHeight']+preview['labelHeight']
        assert min(image.getpixel((8,top+2)))>225
        patch=image.crop((4,top,244,top+preview['rowNoteHeights'][0]));colors=patch.get_flattened_data()
        assert any(r>150 and g<90 and b<90 for r,g,b in colors)
        patch.close()

@pytest.mark.parametrize('transfer',['smpte2084','arib-std-b67'])
def test_hdr_mapping_matches_independent_ffmpeg_reference(processor,parameters,tmp_path,transfer):
    source=tmp_path/f'HDR-{transfer}.mkv'
    subprocess.run([str(ROOT/'.tools/ffmpeg.exe'),'-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc2=duration=1:size=160x90:rate=10','-vf',f'setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709,zscale=p=bt2020:t={transfer}:m=bt2020nc,format=yuv420p10le','-c:v','ffv1',str(source)],check=True,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    info=processor.probe(source);assert info['hdr'] and info['colorTransfer']==transfer
    for mode in ['auto','hable','reinhard','off']:
        result=run(processor,source,{**parameters,'hdrMode':mode},tmp_path/mode)
        assert result['count']==1
        record=manifest(result)['frames'][0]
        reference=tmp_path/f'ref-{mode}.bmp'
        vf='format=rgb24' if mode=='off' else 'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap='+('hable' if mode=='auto' else mode)+':desat=2,zscale=t=bt709:m=bt709:r=full,format=yuv444p,format=rgb24'
        subprocess.run([str(ROOT/'.tools/ffmpeg.exe'),'-hide_banner','-loglevel','error','-y','-i',str(source),'-ss',str(record['actual']),'-vf',vf,'-frames:v','1',str(reference)],check=True,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        with Image.open(record['path']) as saved,Image.open(reference) as expected:
            assert saved.mode=='RGB' and saved.size==(160,90)
            difference=ImageStat.Stat(ImageChops.difference(saved,expected));assert max(difference.mean)<1
    with Image.open(manifest(run(processor,source,{**parameters,'hdrMode':'auto'},tmp_path/'auto','reuse'))['frames'][0]['path']) as auto,Image.open(manifest(run(processor,source,{**parameters,'hdrMode':'off'},tmp_path/'off','reuse'))['frames'][0]['path']) as off:
        assert max(ImageStat.Stat(ImageChops.difference(auto,off)).mean)>5

@pytest.mark.parametrize('detail,category', [('Fresh cookies are needed','访客访问限制'),('HTTP Error 403: Forbidden','访问状态'),('getaddrinfo failed','网络'),('Connection timed out','网络'),('HTTP Error 404','视频不可用'),('Unsupported URL','链接类型'),('Unable to extract title','解析器')])
def test_online_error_categories(detail,category):
    from core import online_diagnostic
    assert '【'+category+'】' in online_diagnostic(detail)

def test_batch_resume_keeps_completed_frame_bytes_and_times(processor,fixtures,parameters,tmp_path):
    from core import Cancelled
    cancel=threading.Event();progress=[]
    def stop(event):
        progress.append(event)
        if event.get('completed',0)>=3:cancel.set()
    source={'source':'local','path':str(fixtures['long']),'name':'batch-resume'}
    settings={**parameters,'interval':.1,'conflict':'batch'}
    with pytest.raises(Cancelled):processor.process(source,settings,str(tmp_path/'output'),cancel,stop,'partial')
    folder=next(event['folder'] for event in progress if 'folder' in event)
    record=json.loads((Path(folder)/'任务记录/partial.json').read_text(encoding='utf8'))
    stamps={entry['path']:Path(entry['path']).stat().st_mtime_ns for entry in record['frames']}
    assert stamps
    result=processor.process(source,settings,str(tmp_path/'output'),threading.Event(),lambda _:None,'partial',folder)
    assert result['folder']==folder and result['count']==99
    assert all(Path(file).stat().st_mtime_ns==stamp for file,stamp in stamps.items())

def test_segment_selection_uses_target_time_not_nearest_frame_time(processor,fixtures,parameters,tmp_path):
    settings={**parameters,'interval':.1,'end':.2,'cropSegments':[{'id':'a','start':.05,'end':.1,'rect':{'x':0,'y':0,'width':.5,'height':1}}]}
    result=run(processor,fixtures['vfr'],settings,tmp_path/'target-crop')
    entry=manifest(result)['frames'][0]
    assert entry['target']==.1 and entry['actual']==.12
    with Image.open(entry['path']) as image:assert image.size==(80,90)
