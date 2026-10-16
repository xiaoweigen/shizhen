import json
import threading
import pytest
import av
from core import target_times, ProcessingError


def test_times_override_uniform_settings_and_are_sorted_unique():
    assert target_times(2., {'times':[500, 0, 221, 500], 'interval':float('nan'), 'start':999}) == [0, 221, 500]


@pytest.mark.parametrize('values', [None, [], [True], [-1], [2000], [2001], [1.0], [float('nan')], [float('inf')], ['100']])
def test_times_reject_invalid_instead_of_falling_back(values):
    with pytest.raises(ProcessingError):
        target_times(2., {'times':values, 'interval':.1})


def test_times_manifest_uses_decoded_pts_and_cache_contract(processor,fixtures,parameters,tmp_path):
    settings={**parameters,'times':[221, 339, 459, 1100], 'sampling':'scene'}
    source=fixtures['vfr']
    result=processor.process({'path':str(source),'name':'times','source':'local'},settings,str(tmp_path/'out'),threading.Event(),lambda e:None,'times')
    manifest=json.loads(__import__('pathlib').Path(result['manifest']).read_text('utf-8'))
    assert [round(row['target']*1000) for row in manifest['frames']] == settings['times']
    with av.open(str(source)) as media:
        stream=media.streams.video[0]
        origin=float(stream.start_time*stream.time_base) if stream.start_time is not None else 0
        decoded=[float(frame.pts*frame.time_base)-origin for frame in media.decode(stream)]
    for row in manifest['frames']:
        nearest=min(decoded,key=lambda actual:(abs(actual-row['target']),actual))
        assert row['actual'] == pytest.approx(nearest,abs=1e-6)
    with pytest.raises(ProcessingError,match='来源或参数'):
        processor.process({'path':str(source),'name':'times','source':'local'},{**settings,'times':[900]},str(tmp_path/'out'),threading.Event(),lambda e:None,'changed')


def test_headless_plan_entry_verifies_media_and_writes_real_frames(fixtures,tmp_path):
    from sample_plan import execute,file_hash
    from pathlib import Path
    source=fixtures['cfr'];file=tmp_path/'plan.json'
    value={'time_unit':'ms','source_media_id':file_hash(source),'settings':{'times':[221,339,459]}}
    file.write_text(json.dumps(value),'utf-8')
    result=execute(source,file,tmp_path/'out')
    frames=json.loads(Path(result['manifest']).read_text('utf-8'))['frames']
    assert len(frames)==3 and [round(r['target']*1000) for r in frames]==[221,339,459]
    value['source_media_id']='sha256:wrong';file.write_text(json.dumps(value),'utf-8')
    with pytest.raises(ProcessingError,match='SHA256'):
        execute(source,file,tmp_path/'rejected')
    assert not (tmp_path/'rejected').exists()


def test_headless_plan_keeps_distinct_close_times_on_variable_rate_video(fixtures,tmp_path):
    from sample_plan import execute,file_hash
    from pathlib import Path
    source=fixtures['vfr'];file=tmp_path/'plan.json'
    requested=[221,222,239]
    file.write_text(json.dumps({'time_unit':'ms','source_media_id':file_hash(source),'settings':{'times':requested}}),'utf-8')
    result=execute(source,file,tmp_path/'out')
    frames=json.loads(Path(result['manifest']).read_text('utf-8'))['frames']
    assert result['times_requested']==3 and result['times_collapsed']==0
    assert [round(row['target']*1000) for row in frames]==requested
    assert all(Path(row['path']).is_file() for row in frames)
