from pathlib import Path
from PIL import Image, ImageDraw
root = Path(r"C:\Users\gaily\OneDrive\Desktop\Iliguide\deliverables\render_final2")
files = sorted(root.glob("page-*.png"), key=lambda p: int(p.stem.split("-")[1]))
thumb_w, thumb_h, pad, cols, rows = 360, 510, 18, 4, 2
for offset in range(0, len(files), cols * rows):
    chunk = files[offset:offset + cols * rows]
    sheet = Image.new("RGB", (cols * thumb_w + (cols + 1) * pad, rows * (thumb_h + 32) + (rows + 1) * pad), "white")
    draw = ImageDraw.Draw(sheet)
    for i, path in enumerate(chunk):
        im = Image.open(path).convert("RGB")
        im.thumbnail((thumb_w, thumb_h))
        x = pad + (i % cols) * (thumb_w + pad)
        y = pad + (i // cols) * (thumb_h + 32 + pad)
        sheet.paste(im, (x, y + 22))
        draw.text((x, y), f"Page {offset + i + 1}", fill="black")
    out = root / f"contact-{offset // (cols * rows) + 1:02}.png"
    sheet.save(out)
    print(out)
print(f"rendered pages: {len(files)}")
