from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1]
assets = root / 'assets'
assets.mkdir(exist_ok=True)
image = Image.new('RGBA', (512, 512), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((12, 12, 500, 500), radius=112, fill='#1c3029')
draw.rounded_rectangle((109, 96, 403, 416), radius=36, outline='#d9e5bd', width=15)
draw.line((164, 104, 164, 408), fill='#d9e5bd', width=12)
draw.line((348, 104, 348, 408), fill='#d9e5bd', width=12)
for top in (137, 221, 305):
    draw.rounded_rectangle((125, top, 148, top + 36), radius=5, fill='#d9e5bd')
    draw.rounded_rectangle((365, top, 388, top + 36), radius=5, fill='#d9e5bd')
draw.polygon(((219, 196), (219, 315), (302, 255)), fill='#a8c982')
image.save(assets / 'icon.png')
image.save(assets / 'icon.ico', sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
