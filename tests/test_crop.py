import threading
import av
import pytest
from PIL import Image, ImageChops
from core import ProcessingError, frame_image
from test_processing import run, manifest, decoded


def test_crop_extracts_exact_pixels_and_scaling_happens_after_crop(processor, fixtures, parameters, tmp_path):
    crop = {'x': .1, 'y': .2, 'width': .5, 'height': .6}
    result = run(processor, fixtures['cfr'], {**parameters, 'crop': crop}, tmp_path / 'crop')
    original = decoded(fixtures['cfr'])
    for record in manifest(result)['frames']:
        _, frame = min(original, key=lambda pair: (abs(pair[0] - record['target']), pair[0]))
        with frame.crop((32, 36, 192, 144)) as expected, Image.open(record['path']) as saved:
            assert saved.size == (160, 108)
            assert ImageChops.difference(saved.convert('RGB'), expected).getbbox() is None
    scaled = run(processor, fixtures['cfr'], {**parameters, 'crop': crop, 'maxWidth': 80}, tmp_path / 'scaled')
    with Image.open(manifest(scaled)['frames'][0]['path']) as image: assert image.size == (80, 54)
    for _, image in original: image.close()


def test_crop_is_applied_in_display_coordinates_after_sar_and_rotation():
    with Image.new('RGB', (320, 180), 'red') as source:
        frame = av.VideoFrame.from_image(source)
    info = {'sar': 2, 'rotation': 90}
    with frame_image(frame, info) as full, frame_image(frame, info, crop={'x': .1, 'y': .25, 'width': .8, 'height': .5}) as cropped:
        assert full.size == (180, 640)
        with full.crop((18, 160, 162, 480)) as expected:
            assert cropped.size == (144, 320)
            assert ImageChops.difference(cropped, expected).getbbox() is None


def test_changed_crop_cannot_skip_old_images_and_null_crop_is_compatible(processor, fixtures, parameters, tmp_path):
    first = run(processor, fixtures['cfr'], parameters, tmp_path / 'output', 'first')
    with pytest.raises(ProcessingError, match='来源或参数'):
        run(processor, fixtures['cfr'], {**parameters, 'crop': {'x': 0, 'y': 0, 'width': .5, 'height': 1}}, tmp_path / 'output', 'changed')
    result = run(processor, fixtures['cfr'], {**parameters, 'crop': None}, tmp_path / 'output', 'compatible')
    assert first['folder'] == result['folder']
    cropped = run(processor, fixtures['cfr'], {**parameters, 'crop': {'x': 0, 'y': 0, 'width': .5, 'height': 1}, 'conflict': 'batch'}, tmp_path / 'output', 'batch')
    assert cropped['folder'] != result['folder']
    with Image.open(manifest(cropped)['frames'][0]['path']) as image: assert image.size == (160, 180)


@pytest.mark.parametrize('crop', [
    {'x': -.1, 'y': 0, 'width': .5, 'height': 1},
    {'x': .7, 'y': 0, 'width': .5, 'height': 1},
    {'x': 0, 'y': 0, 'width': 0, 'height': 1},
    {'x': float('nan'), 'y': 0, 'width': 1, 'height': 1},
])
def test_invalid_crop_is_rejected(crop):
    with Image.new('RGB', (100, 100)) as image:
        frame = av.VideoFrame.from_image(image)
    with pytest.raises(ProcessingError): frame_image(frame, {}, crop=crop)
