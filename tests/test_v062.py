import json
import threading
from pathlib import Path
import pytest
from PIL import Image
from core import ProcessingError, online_diagnostic
from public_share import parse_share
import storyboard

@pytest.mark.parametrize('corner,point',[('tl',(8,8)),('tr',(160,8)),('bl',(8,60)),('br',(160,60))])
def test_marker_default_corners(corner,point):
    assert storyboard.marker_geometry({'markerSize':32,'markerCorner':corner},200,100,'f.png')[1:]==point

def test_marker_custom_position_and_invalid_values():
    assert storyboard.marker_geometry({'markerSize':32,'markerPositions':{'f.png':{'x':.5,'y':.5}}},200,100,'f.png')==(32,84,34)
    with pytest.raises(ValueError):storyboard.marker_geometry({'markerPositions':{'f.png':{'x':-1,'y':0}}},200,100,'f.png')

def test_export_marker_changes_image_and_preserves_notes(tmp_path,parameters):
    file=tmp_path/'frame.png';Image.new('RGB',(200,100),'#668877').save(file)
    records=[{'name':file.name,'path':str(file),'target':.5}]
    settings={**parameters,'columns':1,'rows':1,'thumbWidth':200,'labels':False,'padding':0,'notesEnabled':True,'noteHeight':40,'markersEnabled':True,'markerSize':32,'markerCorner':'br'}
    geometry=storyboard.plan(records,settings)
    target=tmp_path/'sheet.jpg';storyboard.compose_page(records,target,settings,geometry,{},0,lambda *args:None)
    with Image.open(target) as image:
        assert image.size==(200,140)
        assert min(image.getpixel((177,68)))>200  # White marker fill, away from its numeral.
        assert min(image.getpixel((50,120)))>200  # Note blank area still present.
        assert image.getpixel((50,50))[1] in range(120,150)

def test_url_normalization_keeps_bilibili_page_and_removes_tracking(processor):
    assert processor.normalize_url('https://www.bilibili.com/video/BV1abcd/?p=2&spm_id_from=private&trackid=private')=='https://www.bilibili.com/video/BV1abcd/?p=2'
    assert processor.normalize_url('https://www.douyin.com/?modal_id=123456')=='https://www.douyin.com/video/123456'

def test_guest_cookie_is_isolated_and_cleanup_never_removes_user_file(processor,parameters,tmp_path):
    url='https://www.douyin.com/video/123'
    processor.guest_cookies[url]=[{'domain':'.douyin.com','path':'/','secure':True,'name':'visitor','value':'test','expirationDate':0},{'domain':'unrelated.example','name':'private','value':'test'}]
    args=processor._online_args(parameters,url);file=Path(args[args.index('--cookies')+1]);content=file.read_text()
    assert 'visitor' in content and 'private' not in content
    processor._clean_cookie_copy(args);assert not file.exists()
    original=tmp_path/'user-cookie.txt';original.write_text('original')
    args=processor._online_args({**parameters,'cookiePath':str(original)},url)
    processor._clean_cookie_copy(args);assert original.read_text()=='original'

def test_public_share_reads_only_matched_item_and_declines_missing_video():
    item={'aweme_id':'123','desc':'公开样例','video':{'width':720,'height':1280,'duration':4000,'play_addr':{'url_list':['https://www.douyin.com/aweme/v1/play/?video_id=test']}}}
    page='window._ROUTER_DATA = '+json.dumps({'loaderData':{'page':{'items':[item]}}})+';'
    result=parse_share(page,'123');assert result['id']=='123' and result['duration']==4 and result['height']==1280
    with pytest.raises(ValueError):parse_share(page,'456')
    with pytest.raises(ValueError):parse_share('<html>请登录</html>','123')

def test_public_share_fallback_retains_download_method(processor,parameters,monkeypatch):
    def fail(*args,**kwargs):raise ProcessingError(online_diagnostic('Fresh cookies are needed'))
    monkeypatch.setattr(processor,'run',fail)
    monkeypatch.setattr('core.fetch_share',lambda url:{'id':'123','title':'公开样例','duration':4,'webpage_url':'https://www.douyin.com/video/123','ext':'mp4','vcodec':'unknown','width':720,'height':1280})
    result=processor.resolve('https://www.douyin.com/video/123',parameters,threading.Event())
    assert result['publicShare'] is True and result['info']['width']==720

def test_platform_limit_does_not_misdiagnose_login():
    assert '【平台限流】' in online_diagnostic('HTTP Error 412: Precondition Failed')
    assert '不一定要求登录' in online_diagnostic('Fresh cookies are needed')
