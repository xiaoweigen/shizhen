import json, sys
import av
from PIL import Image, ImageChops
from pathlib import Path
record = json.loads(Path(sys.argv[2]).read_text(encoding='utf-8'))
frames = record['frames']
wanted = {}
for entry in frames:
    wanted.setdefault(round(entry['actual'], 6), []).append(entry)
matched = 0
with av.open(sys.argv[1]) as media:
    stream = media.streams.video[0]
    origin = float(stream.start_time * stream.time_base) if stream.start_time is not None else 0
    for frame in media.decode(stream):
        timestamp = round(float(frame.pts * frame.time_base) - origin, 6)
        if timestamp not in wanted:
            continue
        original = frame.to_image()
        info = record.get('info', {})
        if abs(info.get('sar', 1)-1) > .001:
            resized=original.resize((round(original.width*info['sar']),original.height),Image.Resampling.LANCZOS);original.close();original=resized
        if info.get('rotation'):
            rotated=original.rotate(info['rotation'],expand=True);original.close();original=rotated
        for entry in wanted.pop(timestamp):
            image=original.copy()
            settings=record['settings']
            segments=[segment for segment in settings.get('cropSegments',[]) if segment['start']<=entry['target']<=segment['end']]
            crop=max(segments,key=lambda segment:segment['start'])['rect'] if segments else settings.get('crop')
            if crop:
                width,height=image.size
                box=(round(crop['x']*width),round(crop['y']*height),round((crop['x']+crop['width'])*width),round((crop['y']+crop['height'])*height))
                cropped=image.crop(box);image.close();image=cropped
            max_width=settings.get('maxWidth')
            if max_width and image.width>max_width:
                resized=image.resize((max_width,round(image.height*max_width/image.width)),Image.Resampling.LANCZOS);image.close();image=resized
            with Image.open(entry['path']) as saved:
                assert saved.size == image.size, (saved.size, image.size)
                assert ImageChops.difference(saved.convert('RGB'), image).getbbox() is None, entry['name']
            assert abs(entry['target'] - timestamp) <= 1 / (info.get('fps') or 30) + .000001
            matched += 1
            image.close()
        original.close()

assert not wanted, list(wanted)
assert matched == len(frames)
print(json.dumps({'matched': matched, 'exact_pixels': True, 'actual_timestamps_matched': True}))
