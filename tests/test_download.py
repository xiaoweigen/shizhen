import shutil
import threading
import uuid
from pathlib import Path

import pytest
from core import Cancelled, ProcessingError


VIDEO = {'source': 'online', 'url': 'https://www.bilibili.com/video/sample', 'name': '参考:视频', 'platform': 'Bilibili', 'remoteId': 'sample'}


def fake_download(processor, source, monkeypatch):
    def download(video, settings, cancel, emit, output_root=None):
        folder = Path(output_root) / ('.framepick-download-' + uuid.uuid4().hex) if output_root else processor.cache / 'downloads' / uuid.uuid4().hex
        folder.mkdir(parents=True)
        file = folder / ('video' + source.suffix)
        shutil.copyfile(source, file)
        emit({'stage': '下载视频', 'progress': 7.5})
        return file, folder
    monkeypatch.setattr(processor, 'download', download)


def test_download_only_saves_complete_video_to_chosen_location(processor, fixtures, parameters, tmp_path, monkeypatch):
    fake_download(processor, fixtures['cfr'], monkeypatch)
    output = tmp_path / '用户选择的下载位置'
    events = []
    result = processor.download_video(VIDEO, parameters, output, threading.Event(), events.append)
    file = Path(result['downloadPath'])
    assert file.parent == output and file.name == '参考_视频.mkv'
    assert file.read_bytes() == fixtures['cfr'].read_bytes()
    assert result['info']['codec'] == 'ffv1'
    assert len(list(output.iterdir())) == 1  # No frames or storyboard are generated.
    assert not list((processor.cache / 'downloads').glob('*'))
    assert any(event.get('progress') == 45 for event in events)


def test_repeated_download_preserves_same_named_existing_user_files(processor, fixtures, parameters, tmp_path, monkeypatch):
    fake_download(processor, fixtures['cfr'], monkeypatch)
    output = tmp_path / '下载'
    output.mkdir()
    original = output / '参考_视频.mkv'
    original.write_bytes(b'user original')
    first = processor.download_video(VIDEO, parameters, output, threading.Event(), lambda event: None)
    second = processor.download_video(VIDEO, parameters, output, threading.Event(), lambda event: None)
    assert original.read_bytes() == b'user original'
    assert Path(first['downloadPath']).name == '参考_视频 (2).mkv'
    assert Path(second['downloadPath']).name == '参考_视频 (3).mkv'
    assert Path(first['downloadPath']).read_bytes() == fixtures['cfr'].read_bytes()


def test_cancel_during_save_cleans_own_files_and_keeps_user_video(processor, fixtures, parameters, tmp_path, monkeypatch):
    fake_download(processor, fixtures['cfr'], monkeypatch)
    output = tmp_path / '下载'
    output.mkdir()
    original = output / '参考_视频.mkv'
    original.write_bytes(b'user original')
    cancel = threading.Event()
    def emit(event):
        if event.get('stage') == '保存视频': cancel.set()
    with pytest.raises(Cancelled):
        processor.download_video(VIDEO, parameters, output, cancel, emit)
    assert list(output.iterdir()) == [original]
    assert original.read_bytes() == b'user original'
    assert not list((processor.cache / 'downloads').glob('*'))


def test_download_operation_rejects_local_source(processor, parameters, tmp_path):
    with pytest.raises(ProcessingError, match='在线视频'):
        processor.download_video({'source': 'local'}, parameters, tmp_path / 'unused', threading.Event(), lambda event: None)
    assert not (tmp_path / 'unused').exists()


def test_extraction_uses_previously_downloaded_video_without_download_or_cleanup(processor, fixtures, parameters, tmp_path, monkeypatch):
    def unexpected_download(*args):
        pytest.fail('Saved video should be reused for extraction')
    monkeypatch.setattr(processor, 'download', unexpected_download)
    result = processor.process({**VIDEO, 'downloadedPath': str(fixtures['cfr'])}, parameters, tmp_path / '截图', threading.Event(), lambda event: None, 'saved-video')
    assert result['count'] == 3 and fixtures['cfr'].is_file()
    assert len(list(Path(result['folder']).glob('*.png'))) == 3


@pytest.mark.parametrize('saved', [None, 'missing.mp4'])
def test_missing_saved_video_never_downloads_during_extraction(processor, parameters, tmp_path, monkeypatch, saved):
    monkeypatch.setattr(processor, 'download', lambda *a, **kw: pytest.fail('Unexpected network download'))
    video = {**VIDEO, 'downloadedPath': str(tmp_path / saved) if saved else None}
    with pytest.raises(ProcessingError, match='不会自动重新下载'):
        processor.process(video, parameters, tmp_path / 'output', threading.Event(), lambda event: None, 'missing')
    assert not (tmp_path / 'output').exists()


def test_download_assembly_uses_user_folder_and_cleans_failure(processor, parameters, tmp_path, monkeypatch):
    output = tmp_path / 'chosen'; output.mkdir()
    other = output / 'user.txt'; other.write_text('preserve')
    def run(args, *a, **kw):
        destination = Path(args[args.index('-o') + 1])
        assert destination.parent.parent == output
        assert destination.parent.name.startswith('.framepick-download-')
        (destination.parent / 'video.part').write_bytes(b'partial')
        raise ProcessingError('download failed')
    monkeypatch.setattr(processor, 'run', run)
    with pytest.raises(ProcessingError, match='download failed'):
        processor.download_video(VIDEO, parameters, output, threading.Event(), lambda event: None)
    assert list(output.iterdir()) == [other]
    assert not (processor.cache / 'downloads').exists()


def test_download_prefers_native_codec_after_resolution_and_keeps_quality_limit(processor, parameters, tmp_path, monkeypatch):
    def run(args,*a,**kw):
        assert args[args.index('-S')+1]=='res,+vcodec:avc,+acodec:m4a'
        selection=args[args.index('-f')+1]
        assert 'height<=720' in selection and not selection.endswith('/best')
        raise ProcessingError('checked')
    monkeypatch.setattr(processor,'run',run)
    with pytest.raises(ProcessingError,match='checked'):
        processor.download_video(VIDEO,{**parameters,'onlineQuality':720},tmp_path/'output',threading.Event(),lambda e:None)
