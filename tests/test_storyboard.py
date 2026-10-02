import json
import threading
from pathlib import Path

import pytest
from PIL import Image, ImageColor, ImageChops
from core import ProcessingError


COLORS = ['#d83939', '#3a9858', '#345ac2', '#e2bc31', '#9356b1']


@pytest.fixture
def storyboard_source(tmp_path):
    folder = tmp_path / '故事板视频'
    folder.mkdir()
    records = []
    for index in range(10):
        name = f'{(index + 1) / 2:g}s.png'
        file = folder / name
        with Image.new('RGB', (180, 120), COLORS[index % 5]) as image:
            image.save(file)
        records.append({'name': name, 'path': str(file), 'target': (index + 1) / 2, 'actual': (index + 1) / 2})
    manifest = folder / '任务记录' / 'storyboard.json'
    manifest.parent.mkdir()
    manifest.write_text(json.dumps({'frames': records, 'sheets': []}), encoding='utf-8')
    return folder, manifest, records


@pytest.fixture
def grid(parameters):
    return {**parameters, 'rows': 2, 'columns': 3, 'perSheet': 6, 'thumbWidth': 180,
            'padding': 8, 'labels': False, 'notesEnabled': False, 'noteHeight': 96, 'noteFontSize': 18}


def stitch(processor, manifest, names, settings):
    return processor.stitch_manifest(str(manifest), names, settings, threading.Event(), lambda event: None)


def close_color(actual, expected, tolerance=6):
    assert all(abs(a - b) <= tolerance for a, b in zip(actual, ImageColor.getrgb(expected)))


def test_five_images_fill_six_grid_with_last_cell_blank(processor, storyboard_source, grid):
    _, manifest, records = storyboard_source
    names = [r['name'] for r in records[:5]]
    geometry = processor.preview_manifest(manifest, names, grid)
    assert geometry['total'] == 5 and geometry['capacity'] == 6 and geometry['pages'] == 1
    result = stitch(processor, manifest, names, grid)
    with Image.open(result['sheets'][-1]) as image:
        assert image.size == (572, 264)
        for index, color in enumerate(COLORS):
            close_color(image.getpixel((98 + index % 3 * 188, 68 + index // 3 * 128)), color)
        close_color(image.getpixel((474, 196)), grid['background'])
    assert all(Path(record['path']).exists() for record in records)


def test_nine_grid_trims_empty_bottom_rows_but_keeps_last_missing_column(processor, storyboard_source, grid):
    _, manifest, records = storyboard_source
    settings = {**grid, 'rows': 3}
    result = stitch(processor, manifest, [r['name'] for r in records[:5]], settings)
    with Image.open(result['sheets'][-1]) as image:
        assert image.size == (572, 264)
        close_color(image.getpixel((474, 196)), grid['background'])


def test_custom_rows_columns_and_width_change_actual_canvas_size(processor, storyboard_source, grid):
    _, manifest, records = storyboard_source
    names = [records[0]['name']]
    for rows, columns, width in [(1, 2, 180), (4, 5, 180), (4, 5, 90)]:
        settings = {**grid, 'rows': rows, 'columns': columns, 'thumbWidth': width}
        result = stitch(processor, manifest, names, settings)
        with Image.open(result['sheets'][-1]) as image:
            assert image.size == (columns * (width + 8) + 8, (int(width * 2 / 3) + 8) + 8)


def test_storyboard_notes_render_chinese_and_newlines_only_below_present_images(processor, storyboard_source, grid):
    _, manifest, records = storyboard_source
    settings = {**grid, 'notesEnabled': True}
    notes = {records[0]['name']: '镜头一：风吹过森林\n人物抬头，望向天空。'}
    processor.save_stitch_draft(manifest, notes, settings)
    result = stitch(processor, manifest, [r['name'] for r in records[:5]], settings)
    with Image.open(result['sheets'][-1]) as image:
        assert image.size == (572, 456)
        close_color(image.getpixel((470, 200)), '#fffdf7')
        close_color(image.getpixel((474, 356)), grid['background'])
        # Both lines have ink, with no text spilling onto the neighboring blank note.
        for top in (136, 163):
            with image.crop((18, top, 173, top + 23)) as region:
                pixels = list(region.get_flattened_data())
            assert sum(max(pixel) < 160 for pixel in pixels) > 60
        close_color(image.getpixel((236, 165)), '#fffdf7')


def test_disabling_notes_removes_extra_space_without_losing_saved_text(processor, storyboard_source, grid):
    _, manifest, records = storyboard_source
    name = records[0]['name']
    settings = {**grid, 'notesEnabled': True}
    processor.save_stitch_draft(manifest, {name: '保留这段备注'}, settings)
    on = stitch(processor, manifest, [name], settings)
    off = stitch(processor, manifest, [name], grid)
    plain = stitch(processor, manifest, [name], grid)
    with Image.open(on['sheets'][-1]) as image:
        assert image.height == 232
    with Image.open(off['sheets'][-1]) as image, Image.open(plain['sheets'][-1]) as comparison:
        assert image.height == 136
        assert ImageChops.difference(image, comparison).getbbox() is None
    saved = json.loads(manifest.read_text(encoding='utf-8'))
    assert saved['notes'][name] == '保留这段备注'
    assert saved['stitchDraft']['notesEnabled'] is False


def test_selected_images_remain_chronological_and_drafts_survive_export(processor, storyboard_source, grid):
    _, manifest, records = storyboard_source
    selected = [records[4]['name'], records[1]['name']]
    notes = {records[4]['name']: '选中第五张', records[0]['name']: '以后再用', 'missing.png': '无效'}
    processor.save_stitch_draft(manifest, notes, grid)
    preview = processor.preview_manifest(manifest, selected, grid)
    assert [r['name'] for r in preview['frames']] == selected[::-1]
    result = stitch(processor, manifest, selected, grid)
    with Image.open(result['sheets'][-1]) as image:
        close_color(image.getpixel((98, 68)), COLORS[1])
        close_color(image.getpixel((286, 68)), COLORS[4])
        close_color(image.getpixel((474, 68)), grid['background'])
    saved = json.loads(manifest.read_text(encoding='utf-8'))
    assert 'missing.png' not in saved['notes'] and saved['notes'][records[0]['name']] == '以后再用'
    assert saved['stitchHistory'][-1]['names'] == selected[::-1]
    assert len(saved['frames']) == 10


def test_pagination_trims_last_page_rows_but_preserves_capacity(processor, storyboard_source, grid):
    _, manifest, _ = storyboard_source
    settings = {**grid, 'rows': 3}
    preview = processor.preview_manifest(manifest, [], settings, 1)
    assert preview['pages'] == 2 and len(preview['frames']) == 1
    assert preview['rows'] == 1 and preview['capacity'] == 9
    result = stitch(processor, manifest, [], settings)
    assert len(result['sheets']) == 2
    with Image.open(result['sheets'][0]) as image: assert image.size == (572, 392)
    with Image.open(result['sheets'][1]) as image:
        assert image.size == (572, 136)
        close_color(image.getpixel((286, 68)), grid['background'])


def test_long_notes_grow_only_their_row_and_keep_requested_font(processor, storyboard_source, grid):
    import storyboard
    _, manifest, records = storyboard_source
    settings = {**grid, 'notesEnabled': True, 'noteHeight': 40, 'noteFontSize': 28}
    notes = {records[0]['name']: '长备注需要按照选择的字号自动增加高度。' * 25}
    processor.save_stitch_draft(manifest, notes, settings)
    preview = processor.preview_manifest(manifest, [r['name'] for r in records[:5]], settings)
    assert preview['rowNoteHeights'][0] > 40
    assert preview['rowNoteHeights'][1] == 40
    font, lines, line_height, inset = storyboard.note_layout(notes[records[0]['name']], settings, 180)
    assert font.size == 28
    assert preview['rowNoteHeights'][0] >= len(lines) * line_height + 2 * inset
    result = stitch(processor, manifest, [r['name'] for r in records[:5]], settings)
    with Image.open(result['sheets'][-1]) as image:
        assert image.size == (preview['width'], preview['height'])
        close_color(image.getpixel((286, preview['rowTops'][0] + 120 + preview['rowNoteHeights'][0] - 10)), '#fffdf7')
        close_color(image.getpixel((474, preview['rowTops'][1] + 125)), grid['background'])


def test_height_font_and_unsaved_notes_are_used_in_preview(processor, storyboard_source, grid):
    _, manifest, records = storyboard_source
    names = [records[0]['name']]
    settings = {**grid, 'notesEnabled': True, 'noteHeight': 40, 'noteFontSize': 8}
    small = processor.preview_manifest(manifest, names, settings, notes={names[0]: '备注文字' * 40})
    big = processor.preview_manifest(manifest, names, {**settings, 'noteFontSize': 36}, notes={names[0]: '备注文字' * 40})
    tall = processor.preview_manifest(manifest, names, {**settings, 'noteHeight': 300}, notes={})
    assert big['height'] > small['height']
    assert tall['noteHeight'] == 300 and tall['rowNoteHeights'] == [300]


def test_page_only_generation_and_recipe_preserve_images_settings_blank_notes_and_offset(processor, storyboard_source, grid):
    _, manifest, records = storyboard_source
    processor.save_stitch_draft(manifest, {records[-1]['name']: '最后一格的备注'}, grid)
    result = processor.stitch_manifest(manifest, [], {**grid, 'rows': 3}, threading.Event(), lambda event: None, page=1)
    assert len(result['sheets']) == 1
    saved = json.loads(manifest.read_text(encoding='utf-8'))
    recipe = saved['sheetRecipes'][result['sheets'][0]]
    assert recipe['names'] == [records[-1]['name']] and recipe['offset'] == 9
    assert recipe['notes'] == {records[-1]['name']: '最后一格的备注'}
    processor.save_stitch_draft(manifest, {}, grid)
    again = json.loads(manifest.read_text(encoding='utf-8'))
    assert again['sheetRecipes'][result['sheets'][0]] == recipe
    with pytest.raises(ProcessingError, match='不存在'):
        processor.stitch_manifest(manifest, [], grid, threading.Event(), lambda event: None, page=10)


def test_large_canvas_is_rejected_and_legacy_settings_derive_complete_rows(processor, storyboard_source, grid):
    _, manifest, _ = storyboard_source
    large = {**grid, 'rows': 20, 'columns': 20, 'thumbWidth': 1920}
    assert processor.preview_manifest(manifest, [], large)['tooLarge']
    with pytest.raises(ProcessingError, match='2400 万像素'):
        stitch(processor, manifest, [], large)
    legacy = {key: value for key, value in grid.items() if key != 'rows'}
    legacy['perSheet'] = 5
    assert processor.preview_manifest(manifest, [], legacy)['rows'] == 2


def test_oversized_later_page_is_checked_before_any_page_is_written(processor, storyboard_source, grid, monkeypatch):
    import storyboard
    monkeypatch.setattr(storyboard, 'MAX_PIXELS', 200_000)
    folder, manifest, records = storyboard_source
    settings = {**grid, 'notesEnabled': True, 'noteHeight': 40, 'thumbWidth': 80, 'noteFontSize': 36}
    processor.save_stitch_draft(manifest, {records[-1]['name']: '最后一页的长备注' * 90}, settings)
    with pytest.raises(ProcessingError, match='2400 万像素'):
        stitch(processor, manifest, [], settings)
    assert not list(folder.rglob('拼接*.jpg'))
    assert not json.loads(manifest.read_text(encoding='utf-8'))['sheets']
