"""Page geometry shared by the editor and the upstream-backed compositor."""
import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import re
from video_mosaic import mosaic

MAX_PIXELS = 24_000_000

def marker_geometry(settings, width, height, name):
    requested = settings.get('markerSize', 32)
    if not isinstance(requested,(int,float)) or not math.isfinite(requested) or not 12 <= requested <= 120:
        raise ValueError('图序号大小应为 12～120。')
    size = max(4, min(round(requested), width-8, height-8))
    inset = max(0, min(8, (min(width,height)-size)/2))
    corner = settings.get('markerCorner','tl')
    point = settings.get('markerPositions',{}).get(name, {'x':1 if corner.endswith('r') else 0,'y':1 if corner.startswith('b') else 0})
    if not isinstance(point,dict) or not all(isinstance(point.get(key),(int,float)) and math.isfinite(point[key]) and 0 <= point[key] <= 1 for key in ('x','y')):
        raise ValueError('图序号位置超出画面。')
    return size, inset+max(0,width-size-2*inset)*point['x'], inset+max(0,height-size-2*inset)*point['y']

def grid(settings):
    columns = max(1, min(20, int(settings.get('columns') or 4)))
    requested = max(1, min(100, int(settings.get('perSheet') or 20)))
    rows = max(1, min(20, int(settings.get('rows') or math.ceil(requested / columns))))
    if settings.get('layout') == 'horizontal': columns, rows = requested, 1
    elif settings.get('layout') == 'vertical': columns, rows = 1, requested
    return columns, rows, columns * rows

def wrap_text(text, font, width):
    lines = []
    for paragraph in text.replace('\r\n', '\n').replace('\r', '\n').replace('\t', '    ').split('\n'):
        line = ''
        for character in paragraph:
            if line and font.getlength(line + character) > width:
                lines.append(line)
                line = character
            else:
                line += character
        lines.append(line)
    return lines

def note_layout(text, settings, width, height=None):
    inset = max(6, min(14, int(width * .025)))
    size = max(8, min(36, int(settings.get('noteFontSize') or 14)))
    font = mosaic.load_font(size)
    if settings.get('noteFont') == 'arial' and not re.search('[\u3400-\u9fff]',text):
        try: font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf',size)
        except OSError: pass
    # Reserve editor borders, without silently reducing the requested font size.
    lines = wrap_text(text, font, width - inset * 2 - 2)
    return font, lines, math.ceil(size * 1.45), inset

def plan(records, settings, notes=None):
    columns, max_rows, capacity = grid(settings)
    records = records[:capacity]
    width = max(80, min(1920, int(settings.get('thumbWidth') or 480)))
    padding = max(0, min(100, int(settings.get('padding') or 0)))
    rows = max(1, math.ceil(len(records) / columns))
    ratios = []
    for item in records:
        with Image.open(item['path']) as image: ratios.append(image.height / image.width)
    height = int(width * max(ratios))
    if height < 1: raise ValueError('画面比例过宽，请增加拼接图片宽度。')
    label_height = int(max(12, int(width * .04)) * 1.6) if settings.get('labels') else 0
    note_height = max(40, min(500, int(settings.get('noteHeight') or 96))) if settings.get('notesEnabled') else 0
    row_heights = [note_height] * rows
    if note_height:
        for index, item in enumerate(records):
            text = (notes or {}).get(item['name'], '')
            if text:
                _, lines, line_height, inset = note_layout(text, settings, width)
                row = index // columns
                row_heights[row] = max(row_heights[row], len(lines) * line_height + inset * 2 + 2)
    row_tops, canvas_height = [], padding
    for row_height in row_heights:
        row_tops.append(canvas_height)
        canvas_height += height + label_height + row_height + padding
    canvas_width = columns * (width + padding) + padding
    return {'columns': columns, 'rows': rows, 'maxRows': max_rows, 'capacity': capacity,
            'width': canvas_width, 'height': canvas_height, 'imageWidth': width, 'imageHeight': height,
            'labelHeight': label_height, 'noteHeight': note_height, 'rowNoteHeights': row_heights,
            'rowTops': row_tops, 'padding': padding,
            'tooLarge': canvas_width * canvas_height > MAX_PIXELS or max(canvas_width, canvas_height) >= 60000}

def compose_page(records, output, settings, geometry, notes, offset, on_progress):
    g = geometry
    mixed = False
    ratios = []
    for item in records:
        with Image.open(item['path']) as source: ratios.append(source.height / source.width)
    mixed = max(ratios) - min(ratios) > .000001
    base = mosaic.compose_mosaic([(Path(item['path']), item['target']) for item in records], str(output),
                                 cols=g['columns'], thumb_width=g['imageWidth'], padding=g['padding'],
                                 bg_color=settings.get('background') or '#182c26', labels=bool(settings.get('labels')), on_progress=on_progress)
    canvas = None
    try:
        if not mixed and not g['noteHeight'] and not settings.get('markersEnabled') and base.size == (g['width'], g['height']) and offset == 0:
            return
        canvas = Image.new('RGB', (g['width'], g['height']), settings.get('background') or '#182c26')
        draw = ImageDraw.Draw(canvas)
        old_step = g['imageHeight'] + g['labelHeight'] + g['padding']
        for index, item in enumerate(records):
            on_progress(index + 1, len(records))
            column, row = index % g['columns'], index // g['columns']
            x = g['padding'] + column * (g['imageWidth'] + g['padding'])
            y = g['rowTops'][row]
            old_y = g['padding'] + row * old_step
            if mixed:
                with Image.open(item['path']) as source:
                    source = source.convert('RGB')
                    source.thumbnail((g['imageWidth'], g['imageHeight']), Image.Resampling.LANCZOS)
                    canvas.paste(source, (x + (g['imageWidth'] - source.width)//2, y + (g['imageHeight'] - source.height)//2))
                    source.close()
            else:
                with base.crop((x, old_y, x + g['imageWidth'], old_y + g['imageHeight'] + g['labelHeight'])) as region:
                    canvas.paste(region, (x, y))
            if settings.get('markersEnabled'):
                size, dx, dy = marker_geometry(settings,g['imageWidth'],g['imageHeight'],item['name'])
                left, top = round(x+dx), round(y+dy)
                number = str(index+1+(offset if settings.get('markerContinuous') else 0))
                circle = settings.get('markerStyle','circle') == 'circle'
                color, background = settings.get('markerColor','#182c26'), settings.get('markerBackground','#ffffff')
                box = (left,top,left+size-1,top+size-1)
                if circle: draw.ellipse(box,fill=background,outline=color,width=max(1,round(size*.035)))
                else: draw.rectangle(box,fill=background)
                font = mosaic.load_font(max(4,round(size*(.63 if circle else .7)/max(1,len(number)*.55))))
                draw.text((left+size/2,top+size/2),number,font=font,fill=color,anchor='mm')
            if g['labelHeight']:
                font_size = max(12, int(g['imageWidth'] * .04))
                label_y = y + g['imageHeight']
                draw.rectangle((x, label_y, x + g['imageWidth'] - 1, label_y + g['labelHeight'] - 1), fill=settings.get('background') or '#182c26')
                draw.text((x + 6, label_y + (g['labelHeight'] - font_size) // 2),
                          f"#{offset + index + 1}  {mosaic.fmt_timestamp(item['target'])}", fill='#cccccc', font=mosaic.load_font(font_size))
            if g['noteHeight']:
                top, row_height = y + g['imageHeight'] + g['labelHeight'], g['rowNoteHeights'][row]
                draw.rectangle((x, top, x + g['imageWidth'] - 1, top + row_height - 1), fill=settings.get('noteBackground') or '#fffdf7')
                text = notes.get(item['name'], '')
                if text:
                    font, lines, line_height, inset = note_layout(text, settings, g['imageWidth'])
                    for line_index, line in enumerate(lines):
                        align = settings.get('noteAlign','left')
                        position = inset if align == 'left' else (g['imageWidth']-font.getlength(line))/2 if align == 'center' else g['imageWidth']-inset-font.getlength(line)
                        draw.text((x + position, top + inset + line_index * line_height), line, fill=settings.get('noteColor') or '#263a33', font=font)
        canvas.save(output, quality=92, optimize=True)
    finally:
        base.close()
        if canvas is not None: canvas.close()

