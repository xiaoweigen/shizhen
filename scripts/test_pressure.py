"""Real bounded-memory exports: 4K thousand-image batch and a 30-minute source."""
import ctypes
from ctypes import wintypes
from datetime import datetime
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from core import Processor
ROOT=Path(__file__).resolve().parents[1]
ARTIFACT=ROOT/'.test-artifacts'/json.loads((ROOT/'package.json').read_text(encoding='utf-8'))['version']/'pressure'/str(round(time.time()*1000))
ARTIFACT.mkdir(parents=True)
if os.name=='nt':ctypes.windll.kernel32.SetPriorityClass(ctypes.windll.kernel32.GetCurrentProcess(),0x4000)
class Counters(ctypes.Structure):
    _fields_=[('cb',wintypes.DWORD),('PageFaultCount',wintypes.DWORD),('PeakWorkingSetSize',ctypes.c_size_t),('WorkingSetSize',ctypes.c_size_t),('QuotaPeakPagedPoolUsage',ctypes.c_size_t),('QuotaPagedPoolUsage',ctypes.c_size_t),('QuotaPeakNonPagedPoolUsage',ctypes.c_size_t),('QuotaNonPagedPoolUsage',ctypes.c_size_t),('PagefileUsage',ctypes.c_size_t),('PeakPagefileUsage',ctypes.c_size_t)]
def memory():
    ctypes.windll.kernel32.GetCurrentProcess.restype=wintypes.HANDLE
    ctypes.windll.psapi.GetProcessMemoryInfo.argtypes=[wintypes.HANDLE,ctypes.POINTER(Counters),wintypes.DWORD]
    counters=Counters();counters.cb=ctypes.sizeof(counters)
    ctypes.windll.psapi.GetProcessMemoryInfo(ctypes.windll.kernel32.GetCurrentProcess(),ctypes.byref(counters),counters.cb)
    return counters.WorkingSetSize
def fixture(name,duration,size,rate,pattern='color=c=darkgreen'):
    file=ARTIFACT/(name+'.mkv')
    subprocess.run([str(ROOT/'.tools/ffmpeg.exe'),'-hide_banner','-loglevel','error','-y','-f','lavfi','-i',f'{pattern}{chr(58) if chr(61) in pattern else chr(61)}duration={duration}:size={size}:rate={rate}','-c:v','libx264','-preset','veryfast','-threads','2','-pix_fmt','yuv420p',str(file)],check=True,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0)|getattr(subprocess,'BELOW_NORMAL_PRIORITY_CLASS',0))
    return file
parameters={'interval':1,'start':0,'end':None,'includeStart':False,'format':'png','quality':92,'maxWidth':None,'conflict':'skip','autoStitch':False,'layout':'grid','columns':3,'rows':3,'perSheet':9,'thumbWidth':240,'padding':4,'labels':True,'background':'#182c26','onlineQuality':360,'cookiePath':'','keepDownload':False,'crop':None,'cropSegments':[],'sampling':'interval','deduplicate':False,'similarity':5,'sceneThreshold':18,'hdrMode':'auto'}
processor=Processor(str(ROOT/'.tools'),str(ARTIFACT/'cache'))
cases=[]
for name,source,interval,expected in [('4K-999',fixture('4K样本',1,'3840x2160',10),.001,999),('30min-899',fixture('30分钟样本',1800,'160x90',1,'testsrc2'),2,899)]:
    print('TEST '+name,flush=True)
    peak=[memory()];stop=threading.Event()
    def monitor():
        while not stop.wait(.1):peak[0]=max(peak[0],memory())
    thread=threading.Thread(target=monitor,daemon=True);thread.start()
    begin=time.monotonic()
    try:result=processor.process({'id':name,'source':'local','path':str(source),'name':source.stem},{**parameters,'interval':interval},str(ARTIFACT/'results'),threading.Event(),lambda _:None,name)
    finally:stop.set();thread.join()
    manifest=json.loads(Path(result['manifest']).read_text(encoding='utf8'))
    assert result['count']==expected
    thumbs=processor.thumbnails([entry['path'] for entry in manifest['frames'][:60]])
    bytes_saved=sum(Path(entry['path']).stat().st_size for entry in manifest['frames'])
    bytes_small=sum(Path(entry['thumbnail']).stat().st_size for entry in thumbs)
    elapsed=time.monotonic()-begin
    assert peak[0]<700*1024*1024
    cases.append({'name':name,'status':'passed','source':str(source),'duration':manifest['info']['duration'],'resolution':[manifest['info']['width'],manifest['info']['height']],'frames':expected,'seconds':round(elapsed,2),'peakWorkingSetBytes':peak[0],'outputBytes':bytes_saved,'first60ThumbnailBytes':bytes_small,'job':{**result,'id':name,'videoId':name,'name':source.stem,'status':'done','stage':'处理完成','progress':100,'total':expected,'completed':expected,'createdAt':datetime.now().isoformat(),'settings':{**parameters,'interval':interval},'outputRoot':str(ARTIFACT/'results')}})
    (ARTIFACT/'report.json').write_text(json.dumps({'cases':cases,'artifact':str(ARTIFACT)},ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps({'case':name,'frames':expected,'seconds':round(elapsed,2),'peakMB':round(peak[0]/1024**2,2)}),flush=True)
print(str(ARTIFACT/'report.json'),flush=True)
