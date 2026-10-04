"""Read media metadata supplied by Douyin's public mobile share page."""
import json
import re
from urllib.parse import urlparse, unquote
from urllib.request import Request, urlopen

MOBILE_UA='Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 Version/16.0 Mobile/15E148 Safari/604.1'

def allowed(url):
    parsed=urlparse(url);host=parsed.hostname or ''
    return parsed.scheme in ('https','http') and any(host==d or host.endswith('.'+d) for d in ('douyin.com','iesdouyin.com','amemv.com','snssdk.com','douyinvod.com','bytecdn.cn','bytecdn.com','ibytedtos.com'))

def parse_share(page, identity):
    documents=[]
    for match in re.finditer(r'(?:window\.)?_ROUTER_DATA\s*=\s*',page):
        try: documents.append(json.JSONDecoder().raw_decode(page[match.end():].lstrip())[0])
        except ValueError: pass
    for match in re.finditer(r'<script[^>]+id=["\']RENDER_DATA["\'][^>]*>(.*?)</script>',page,re.S):
        try: documents.append(json.loads(unquote(match[1])))
        except ValueError: pass
    pending=documents.copy();visited=0
    while pending and visited<20000:
        item=pending.pop();visited+=1
        if isinstance(item,list):pending.extend(item)
        elif isinstance(item,dict):
            if str(item.get('aweme_id',''))==identity and isinstance(item.get('video'),dict):
                video=item['video'];play=video.get('play_addr') or {};urls=play.get('url_list') or []
                media=next((u for u in urls if isinstance(u,str) and allowed(u)),None)
                if not media:continue
                cover=video.get('cover') or video.get('origin_cover') or {}
                return {'id':identity,'title':item.get('desc') or identity,'duration':float(video.get('duration') or item.get('duration') or 0)/1000,'webpage_url':'https://www.douyin.com/video/'+identity,'ext':'mp4','thumbnail':next(iter(cover.get('url_list') or []),None),'width':video.get('width') or play.get('width') or 0,'height':video.get('height') or play.get('height') or 0,'vcodec':'下载后核验','url':media,'http_headers':{'User-Agent':MOBILE_UA,'Referer':'https://www.iesdouyin.com/'}}
            pending.extend(item.values())
    raise ValueError('公开分享页未提供可用的视频数据，可能需要验证或受到访问权限限制。')

def fetch_share(url):
    match=re.search(r'/(?:share/)?video/(\d+)',url)
    identity=match[1] if match else None
    target='https://www.iesdouyin.com/share/video/'+identity+'/' if identity else url
    if not allowed(target):raise ValueError('分享页地址无效。')
    with urlopen(Request(target,headers={'User-Agent':MOBILE_UA}),timeout=15) as response:
        final=response.geturl()
        if not allowed(final):raise ValueError('分享页跳转地址无效。')
        match=re.search(r'/(?:share/)?video/(\d+)',final)
        identity=identity or (match[1] if match else None)
        data=response.read(8*1024*1024+1)
    if len(data)>8*1024*1024 or not identity:raise ValueError('分享链接不完整或页面过大。')
    return parse_share(data.decode('utf-8','replace'),identity)
