"""Software AV1 decode from the bundled PyAV engine, with H.264/AAC output."""
from fractions import Fraction
import math
import av
from PIL import Image


def encode(source,destination,info,ranges,cancel,progress,preview=False):
    from core import check_cancel,frame_image
    rate=Fraction(str(info.get('fps') or 30)).limit_denominator(1001)
    total=sum(r['end']-r['start'] for r in ranges);offset=0
    # Audio can open the muxer before the first video frame arrives.
    # Set the displayed dimensions before either stream begins encoding.
    with Image.new('RGB',(max(1,round(info['width']*(info.get('sar') or 1))),info['height'])) as canvas:
        rotated=canvas.rotate(info.get('rotation') or 0,expand=True)
        width,height=rotated.size;rotated.close()
    if preview and width>960:height=max(1,round(height*960/width));width=960
    width,height=max(2,width//2*2),max(2,height//2*2)
    with av.open(str(destination),'w',format='mp4',options={'movflags':'+faststart'}) as output:
        video_out=output.add_stream('libx264',rate=rate)
        video_out.width=width;video_out.height=height
        video_out.pix_fmt='yuv420p';video_out.options={'preset':'veryfast','crf':'25' if preview else '18'}
        video_out.codec_context.thread_count=2;video_out.codec_context.time_base=Fraction(1,90000)
        audio_out=output.add_stream('aac',rate=48000) if info.get('audioCodec') not in ('无音轨','',None) else None
        if audio_out: audio_out.layout='stereo';audio_out.bit_rate=128000
        initialized=False;last_video_pts=-1
        for r in ranges:
            with av.open(str(source)) as media:
                video=media.streams.video[0];video.codec_context.thread_count=2
                audio=media.streams.audio[0] if audio_out and media.streams.audio else None
                origin=float(video.start_time*video.time_base) if video.start_time is not None else info.get('_startTime',0)
                media.seek(max(0,int((r['start']+origin)*av.time_base)),backward=True,any_frame=False)
                resampler=av.AudioResampler(format='fltp',layout='stereo',rate=48000) if audio else None
                video_done=False;audio_done=not bool(audio)
                for packet in media.demux(*([video,audio] if audio else [video])):
                    check_cancel(cancel)
                    for frame in packet.decode():
                        if frame.pts is None: continue
                        timestamp=float(frame.pts*frame.time_base)-origin
                        if isinstance(frame,av.VideoFrame):
                            if timestamp>=r['end']-1e-8: video_done=True;continue
                            if timestamp<r['start']-1e-8: continue
                            image=frame_image(frame,info,960 if preview else None)
                            try:
                                if image.size!=(width,height):
                                    resized=image.resize((width,height));image.close();image=resized
                                initialized=True
                                encoded=av.VideoFrame.from_image(image)
                            finally:image.close()
                            pts=round((offset+timestamp-r['start'])*90000)
                            if pts<=last_video_pts: continue
                            last_video_pts=pts;encoded.pts=pts;encoded.time_base=Fraction(1,90000)
                            for out_packet in video_out.encode(encoded):output.mux(out_packet)
                            progress(min(.99,(offset+timestamp-r['start'])/total))
                        elif audio and resampler:
                            if timestamp>=r['end']:audio_done=True;continue
                            for chunk in resampler.resample(frame):
                                t=float(chunk.pts*chunk.time_base)-origin if chunk.pts is not None else timestamp
                                left=max(0,math.ceil((r['start']-t)*48000-1e-6));right=min(chunk.samples,math.ceil((r['end']-t)*48000-1e-6))
                                if right<=left:continue
                                cut=av.AudioFrame(format='fltp',layout='stereo',samples=right-left);cut.sample_rate=48000
                                cut.pts=round((offset+t+left/48000-r['start'])*48000);cut.time_base=Fraction(1,48000)
                                for incoming,outgoing in zip(chunk.planes,cut.planes):outgoing.update(bytes(incoming)[left*4:right*4])
                                for out_packet in audio_out.encode(cut):output.mux(out_packet)
                    if video_done and audio_done:break
            offset+=r['end']-r['start']
        if not initialized:raise ValueError('选区内没有可解码的视频画面。')
        for packet in video_out.encode(None):output.mux(packet)
        if audio_out:
            for packet in audio_out.encode(None):output.mux(packet)
