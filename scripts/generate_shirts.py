"""Generate original transparent placeholder garments. Optional: pip install Pillow.

The application uses the committed PNGs, so Pillow is NOT a runtime dependency.
Shoulder seams at (180, 112), (420, 112); hem at y=520; canvas 600x650.
"""
from pathlib import Path
import math

from PIL import Image, ImageDraw, ImageFilter

OUTPUT = Path(__file__).resolve().parents[1] / "static" / "shirts"
OUTPUT.mkdir(parents=True, exist_ok=True)
SCALE = 2
OUTLINE = [(240,82),(210,89),(180,112),(150,123),(60,193),(96,264),
           (158,230),(163,350),(154,516),(199,526),(400,526),(446,516),
           (437,350),(442,230),(504,264),(540,193),(450,123),(420,112),
           (390,89),(360,82),(350,99),(336,114),(318,123),(300,126),
           (282,123),(264,114),(250,99)]


def make_shirt(name, color):
    size = (600*SCALE, 650*SCALE)
    mask = Image.new("L", size)
    draw = ImageDraw.Draw(mask)
    draw.polygon([(x*SCALE,y*SCALE) for x,y in OUTLINE], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(0.6))
    fabric = Image.new("RGBA", size)
    pixels = fabric.load()
    for y in range(size[1]):
        for x in range(size[0]):
            px, py = x/SCALE, y/SCALE
            # Gentle folds and edge shading give the original placeholder
            # assets a fabric-like appearance without external stock photos.
            shade = 1 + .085*math.cos((px-300)/120) - .07*abs(px-300)/300
            shade += .025*math.sin(px*.075+py*.011) + .016*math.cos(px*.16-py*.016)
            shade += .008*math.sin(py*2.1)
            shade -= .12*math.exp(-((px-175)/18)**2)*min(1,max(0,(py-220)/180))
            shade -= .10*math.exp(-((px-425)/18)**2)*min(1,max(0,(py-220)/180))
            pixels[x,y] = (*[max(0,min(255,round(c*shade))) for c in color],255)
    fabric.putalpha(mask)
    seam = ImageDraw.Draw(fabric)
    dark = (*[int(c*.76) for c in color],255)
    light = (*[min(255,int(c*1.07+3)) for c in color],255)
    def line(points, fill, width=1):
        seam.line([(x*SCALE,y*SCALE) for x,y in points],fill=fill,width=width*SCALE,joint="curve")
    line([(240,86),(250,105),(268,122),(285,130),(300,133),(315,130),(332,122),(350,105),(360,86)],dark,7)
    line([(242,85),(253,103),(270,117),(285,125),(300,128),(315,125),(330,117),(347,103),(358,85)],light,1)
    line([(180,114),(165,173),(158,228)],dark)
    line([(420,114),(435,173),(442,228)],dark)
    line([(68,193),(104,255)],light)
    line([(532,193),(496,255)],light)
    line([(158,507),(204,517),(397,517),(442,507)],dark)
    line([(160,510),(204,520),(397,520),(440,510)],light)
    # A tiny woven label near the hem, and a completely transparent neck.
    seam.rounded_rectangle((399*SCALE,490*SCALE,416*SCALE,503*SCALE),radius=2,fill=(214,214,197,255))
    line([(404,493),(404,499),(412,499)],(97,110,88,255))
    fabric.resize((600,650),Image.Resampling.LANCZOS).save(OUTPUT / f"{name}_tshirt.png")


if __name__ == "__main__":
    for name, color in {"black":(48,50,50),"white":(231,228,216),"blue":(96,133,153),"red":(166,77,65)}.items():
        make_shirt(name,color)
        print(f"Generated {name}_tshirt.png")
