import shutil
import threading
import uuid
from pathlib import Path

import pytest
from core import Cancelled, ProcessingError


VIDEO = {'source': 'online', 'url': 'https://www.bilibili.com/video/sample', 'name': '参考:视频', 'platform': 'Bilibili', 'remoteId': 'sample'}


def fake_download(processor, source, monkeypatch):
    def download(video, settings, cancel, emit):
        folder = processor.cache / 'downloads' / uuid.uuid4().hex
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
