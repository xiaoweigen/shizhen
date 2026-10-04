import hashlib
import threading
from pathlib import Path

import av
import pytest
from PIL import ImageChops, ImageStat
from core import Cancelled
from video_editing import prepare_preview, trim_video, validate_ranges


@pytest.mark.parametrize('ranges', [[], [{'start':-1,'end':1}], [{'start':0,'end':float('nan')}], [{'start':0,'end':11}], [{'start':1,'end':1}], [{'start':True,'end':2}], [{'start':0,'end':3},{'start':2,'end':4}]])
def test_invalid_trim_ranges(ranges):
    with pytest.raises(ValueError): validate_ranges(ranges,10)


def test_ranges_sort_and_allow_adjacent():
    assert validate_ranges([{'start':2,'end':4},{'start':0,'end':2}],5)==[{'start':0,'end':2},{'start':2,'end':4}]


def test_non_keyframe_join_and_source_protection(processor, fixtures, parameters, tmp_path):
    source=fixtures['cfr'];before=hashlib.sha256(source.read_bytes()).hexdigest()
    result=trim_video(processor,{'source':'local','path':str(source),'name':'剪切测试'},parameters,str(tmp_path/'output'),[{'start':.3,'end':.8},{'start':1.2,'end':1.7}],True,threading.Event(),lambda e:None)
    file=Path(result['outputFiles'][0]);info=processor.probe(file,False)
    assert abs(info['duration']-1)<.11 and info['codec']=='h264'
    assert hashlib.sha256(source.read_bytes()).hexdigest()==before
    with av.open(str(file)) as media:
        frames=list(media.decode(video=0))
        assert len(frames)==10
        times=[float(f.pts*f.time_base) for f in frames]
        assert times==sorted(times) and times[0]==0
        for index,(source_time,output_index) in enumerate(((.3,0),(1.2,5))):
            with av.open(str(source)) as original:
                original_frames=list(original.decode(video=0))
            ref=original_frames[round(source_time*10)].to_image().convert('RGB')
            actual=frames[output_index].to_image().convert('RGB')
            assert sum(ImageStat.Stat(ImageChops.difference(ref,actual)).mean)/3<5


def test_split_keeps_audio_and_existing_files(processor,fixtures,parameters,tmp_path):
    source=fixtures['audio_longer'];root=tmp_path/'out';root.mkdir();existing=root/'声音 · 片段01.mp4';existing.write_bytes(b'user-file')
    result=trim_video(processor,{'source':'local','path':str(source),'name':'声音'},parameters,str(root),[{'start':0,'end':.4},{'start':.6,'end':1}],False,threading.Event(),lambda e:None)
    assert len(result['outputFiles'])==2 and existing.read_bytes()==b'user-file'
    for file in result['outputFiles']:
        info=processor.probe(file,False)
        assert info['audioCodec']=='aac' and abs(info['duration']-.4)<.11
        with av.open(file) as media: assert len(list(media.decode(audio=0)))>0


def test_cancel_removes_only_current_output(processor,fixtures,parameters,tmp_path):
    root=tmp_path/'out';root.mkdir();other=root/'other.txt';other.write_text('preserve');cancel=threading.Event()
    def stop(event):
        if str(event.get('stage','')).startswith('剪切视频'): cancel.set()
    with pytest.raises(Cancelled):
        trim_video(processor,{'source':'local','path':str(fixtures['long']),'name':'取消'},parameters,str(root),[{'start':0,'end':8}],True,cancel,stop)
    assert list(root.iterdir())==[other]


def test_hevc_preview_is_playable_and_cached(processor,fixtures,parameters):
    original=fixtures['hevc'];before=original.read_bytes()
    video={'source':'local','path':str(original),'name':'HEVC'}
    first=prepare_preview(processor,video,parameters,threading.Event(),lambda e:None,True)
    file=Path(first['path']);stat=file.stat().st_mtime_ns
    assert first['converted'] is True and processor.probe(file,False)['codec']=='h264'
    second=prepare_preview(processor,video,parameters,threading.Event(),lambda e:None,True)
    assert first==second and file.stat().st_mtime_ns==stat and original.read_bytes()==before


def test_preview_rotation_and_audio(processor,fixtures,parameters):
    result=prepare_preview(processor,{'source':'local','path':str(fixtures['rotated'])},parameters,threading.Event(),lambda e:None,True)
    info=processor.probe(result['path'],False)
    assert (info['width'],info['height'])==(90,160) and info['rotation']==0 and info['audioCodec']=='aac'


def test_native_attempt_never_transcodes_or_copies_hevc(processor,fixtures,parameters,monkeypatch):
    monkeypatch.setattr('video_editing._encode', lambda *a, **kw: pytest.fail('Conversion must be opt-in'))
    source=fixtures['hevc']
    result=prepare_preview(processor,{'source':'online','downloadedPath':str(source)},parameters,threading.Event(),lambda e:None)
    assert result == {'path':str(source.resolve()),'source':str(source.resolve()),'converted':False}
    assert not (processor.cache/'playback').exists()


@pytest.mark.parametrize('operation', ['preview', 'trim'])
def test_missing_online_file_does_not_use_legacy_cache_or_download(processor,fixtures,parameters,tmp_path,monkeypatch,operation):
    monkeypatch.setattr(processor,'download',lambda *a, **kw:pytest.fail('Unexpected network download'))
    cached=processor.cache/'playback'/'old.mp4';cached.parent.mkdir();cached.write_bytes(fixtures['cfr'].read_bytes())
    video={'source':'online','name':'missing','previewSource':str(cached),'downloadedPath':str(tmp_path/'gone.mp4')}
    with pytest.raises(ValueError,match='不会自动重新下载'):
        if operation=='preview':prepare_preview(processor,video,parameters,threading.Event(),lambda e:None,True)
        else:trim_video(processor,video,parameters,tmp_path/'out',[{'start':0,'end':1}],True,threading.Event(),lambda e:None)
    assert cached.is_file()


def test_online_trim_uses_saved_video_offline(processor,fixtures,parameters,tmp_path,monkeypatch):
    monkeypatch.setattr(processor,'download',lambda *a, **kw:pytest.fail('Unexpected network download'))
    source=fixtures['audio_longer'];before=source.read_bytes()
    result=trim_video(processor,{'source':'online','name':'saved','downloadedPath':str(source)},parameters,tmp_path/'out',[{'start':.1,'end':.4}],True,threading.Event(),lambda e:None)
    assert processor.probe(result['outputFiles'][0],False)['codec']=='h264'
    assert source.read_bytes()==before


def test_failed_encode_leaves_no_placeholder(processor,fixtures,parameters,tmp_path,monkeypatch):
    def fail(*args,**kwargs): raise RuntimeError('encoder failed')
    monkeypatch.setattr('video_editing._encode',fail)
    with pytest.raises(RuntimeError): trim_video(processor,{'source':'local','path':str(fixtures['cfr']),'name':'失败'},parameters,str(tmp_path/'out'),[{'start':0,'end':1}],True,threading.Event(),lambda e:None)
    assert not list((tmp_path/'out').iterdir())


@pytest.mark.parametrize('fixture,dimensions',[('audio_longer',(160,90)),('rotated',(90,160))])
def test_software_encoder_audio_first_join_and_rotation(processor,fixtures,tmp_path,fixture,dimensions):
    from av_encoder import encode
    source=fixtures[fixture];destination=tmp_path/'software.mp4'
    encode(source,destination,processor.probe(source,False),[{'start':.1,'end':.4},{'start':.6,'end':.9}],threading.Event(),lambda value:None,True)
    info=processor.probe(destination,False)
    assert info['codec']=='h264' and info['audioCodec']=='aac'
    assert (info['width'],info['height'])==dimensions and abs(info['duration']-.6)<.11
    with av.open(str(destination)) as media:
        frames=list(media.decode(video=0))
        assert len(frames)==6 and frames[0].pts==0
    with av.open(str(destination)) as media:
        audio=list(media.decode(audio=0));assert audio and sum(frame.samples for frame in audio)>24000
