"""Bounded, reusable FFmpeg HDR filter. Only sampled frames cross the pipe."""
import os
import queue
import subprocess
import threading
import time
from PIL import Image

def filter_chain(info, mode):
    transfer = 'smpte2084' if info.get('colorTransfer') == 'smpte2084' else 'arib-std-b67'
    primaries = info.get('colorPrimaries') or 'bt2020'
    matrix = info.get('colorSpace') or 'bt2020nc'
    range_name='full' if info.get('colorRange')=='pc' else 'limited'
    return (f'setparams=range={range_name}:color_primaries={primaries}:color_trc={transfer}:colorspace={matrix},zscale=t=linear:npl=100,'
            'format=gbrpf32le,zscale=p=bt709,'
            f'tonemap=tonemap={mode}:desat=2,'
            'zscale=t=bt709:m=bt709:r=full,format=yuv444p,format=rgb24')

class ToneMapper:
    def __init__(self, processor, info, mode, cancel):
        self.processor, self.info, self.mode, self.cancel = processor, info, mode, cancel
        self.process = None
        self.cached_frame = None
        self.cached_image = None

    def image(self, frame):
        import core
        if frame is self.cached_frame and self.cached_image is not None:
            return self.cached_image.copy()
        # Planar ten-bit input removes format-specific padding and interleaving.
        source = frame.reformat(format='yuv420p10le')
        planes = []
        for plane in source.planes:
            raw = bytes(plane)
            row_bytes = plane.width*2
            planes.append(b''.join(raw[row*plane.line_size:row*plane.line_size+row_bytes] for row in range(plane.height)))
        args = [self.processor.tool('ffmpeg'), '-hide_banner', '-loglevel', 'error', '-threads', '1', '-filter_threads', '1',
                '-f', 'rawvideo', '-pixel_format', 'yuv420p10le', '-video_size', f'{frame.width}x{frame.height}', '-framerate', '1', '-i', 'pipe:0',
                '-vf', filter_chain(self.info,self.mode), '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1']
        env = {key:value for key,value in os.environ.items() if not key.startswith('_PYI_')}
        env['PYINSTALLER_RESET_ENVIRONMENT']='1'
        with core.EXTERNAL_SPAWN_LOCK:
            frozen = getattr(core.sys,'_MEIPASS',None)
            if os.name == 'nt' and frozen: core.ctypes.windll.kernel32.SetDllDirectoryW(None)
            try: self.process = subprocess.Popen(args,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,creationflags=core.NO_WINDOW,env=env)
            finally:
                if os.name == 'nt' and frozen: core.ctypes.windll.kernel32.SetDllDirectoryW(str(frozen))
        process=self.process
        result=[];failure=[]
        def communicate():
            try: result.extend(process.communicate(b''.join(planes)))
            except (OSError,ValueError) as error: failure.append(error)
        thread=threading.Thread(target=communicate,daemon=True);thread.start()
        started=time.monotonic()
        try:
            while thread.is_alive():
                core.check_cancel(self.cancel)
                if time.monotonic()-started>45: raise core.ProcessingError('HDR 映射超时，请降低图片尺寸或检查素材。')
                thread.join(.05)
            if failure or process.returncode or not result or len(result[0])!=frame.width*frame.height*3:
                detail=result[1].decode('utf8',errors='replace')[-600:] if len(result)>1 else ''
                raise core.ProcessingError('HDR 映射失败：'+detail)
            image=Image.frombytes('RGB',(frame.width,frame.height),result[0])
            if self.cached_image is not None:self.cached_image.close()
            self.cached_image=image.copy();self.cached_frame=frame
            return image
        finally:
            if process.poll() is None:process.kill()
            process.wait(timeout=5);thread.join(timeout=3)
            self.process=None

    def close(self):
        if self.process and self.process.poll() is None:self.process.kill()
        self.process=None
        if self.cached_image is not None:self.cached_image.close()
        self.cached_image=None;self.cached_frame=None
