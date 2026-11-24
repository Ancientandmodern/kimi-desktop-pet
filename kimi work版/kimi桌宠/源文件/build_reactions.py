"""Build the mouse reactions from the original idle cel and three key poses."""

from argparse import ArgumentParser
import json
from math import cos, pi, sin
from pathlib import Path

from PIL import Image, ImageDraw


ART = Path(__file__).resolve().parent / "素材"
SIZE, COLUMNS = 320, 12


def pose(cel, *, x=0, y=0, angle=0, stretch=1, pivot=(163, 294)):
    """Keep the chosen pivot fixed while rotating or stretching a cel."""
    a = angle * pi / 180
    c, s = cos(a), sin(a)
    px, py = pivot
    return cel.transform(
        cel.size, Image.Transform.AFFINE,
        (c, s, px - c * (px + x) - s * (py + y),
         -s / stretch, c / stretch, py + (s * (px + x) - c * (py + y)) / stretch),
        Image.Resampling.BICUBIC,
    )


def angry_mark(cel, strength):
    """Place a small comic anger mark in the empty area beside her hair."""
    size = 40
    mark = Image.new("RGBA", (size * 3, size * 3))
    draw = ImageDraw.Draw(mark)
    strokes = [[(0, -11), (0, -4), (-4, 0), (-11, 0)],
               [(11, 0), (4, 0), (0, 4), (0, 11)]]
    for stroke in strokes:
        points = [(round((20 + x * strength) * 3), round((20 + y * strength) * 3))
                  for x, y in stroke]
        draw.line(points, fill=(255, 230, 230, 255), width=15, joint="curve")
        draw.line(points, fill=(223, 81, 105, 255), width=8, joint="curve")
    result = cel.copy()
    result.alpha_composite(mark.resize((size, size), Image.Resampling.LANCZOS), (244, 39))
    return result


def write_preview(destination, segments):
    # One shared solid backdrop lets the preview retain clean antialiased edges.
    frames, durations = [], []
    for segment in segments:
        for cel, ms in segment:
            background = Image.new("RGBA", cel.size, (36, 41, 57, 255))
            background.alpha_composite(cel)
            frames.append(background.convert("RGB"))
            durations.append(ms)
    destination.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(destination, save_all=True, append_images=frames[1:],
                   duration=durations, loop=0, disposal=1)


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--preview", type=Path)
    args = parser.parse_args()
    original = json.loads((ART / "片段时间轴.json").read_text(encoding="utf-8-sig"))
    with Image.open(ART / "atlas.webp") as atlas:
        tile = original["blink"]["offset"]
        x, y = tile % COLUMNS * SIZE, tile // COLUMNS * SIZE
        idle = atlas.crop((x, y, x + SIZE, y + SIZE)).convert("RGBA")
    keys = {}
    for name in ("grab", "tap", "mad"):
        with Image.open(ART / "交互关键帧" / f"{name}.png") as image:
            if image.size != idle.size or image.mode != "RGBA":
                raise ValueError(f"{name}.png must be a {SIZE}×{SIZE} RGBA image")
            keys[name] = image.copy()

    def lift(height, angle, sideways=0):
        return pose(keys["grab"], x=sideways, y=height, angle=angle,
                    stretch=.94, pivot=(173, 80))

    lift_off = [idle, pose(idle, y=-2, angle=-.4, stretch=1.012),
                pose(idle, y=-5, angle=-.8, stretch=1.01),
                lift(-2, -1.1), lift(-5, -.9), lift(-8, -.45), lift(-10, 0)]
    enter = list(zip(lift_off, (30, 40, 40, 40, 50, 50, 50)))
    settle = list(zip(reversed(lift_off), (40, 40, 50, 40, 40, 40, 50)))
    settle += [(pose(idle, y=1, stretch=.992), 50), (idle, 70)]
    sway = []
    for frame in range(16):
        phase = frame / 16 * 2 * pi
        sway.append((lift(-10 + (1 - cos(phase * 2)) * .9, sin(phase) * 2.6,
                          sin(phase) * 1.4), 70))

    tap = [
        (idle, 20), (pose(keys["tap"], x=-1, angle=-1.1), 50),
        (pose(keys["tap"], x=2, angle=1.25), 60),
        (pose(keys["tap"], x=-1, angle=-.72), 60),
        (pose(keys["tap"], angle=.36), 90), (keys["tap"], 80),
        (pose(idle, angle=.15), 50), (idle, 50),
    ]
    mad = [
        (idle, 20), (pose(keys["mad"], y=1, angle=-.8, stretch=.988), 60),
        (angry_mark(pose(keys["mad"], y=-4, angle=1, stretch=1.008), .73), 90),
        (angry_mark(pose(keys["mad"], y=-1, angle=.32), 1.05), 100),
        (angry_mark(keys["mad"], 1), 360), (keys["mad"], 140),
        (pose(idle, y=1, stretch=.996), 70), (idle, 80),
    ]
    segments = {"grab_enter": enter, "grab_loop": sway, "grab_exit": settle,
                "reaction_tap": tap, "reaction_mad": mad}

    frames, timeline = [], {}
    for name, segment in segments.items():
        start = len(frames)
        frames.extend(cel for cel, _ in segment)
        timeline[name] = {"offset": start, "count": len(segment), "ms": [ms for _, ms in segment]}
    atlas = Image.new("RGBA", (SIZE * COLUMNS, SIZE * ((len(frames) + COLUMNS - 1) // COLUMNS)))
    for tile, frame in enumerate(frames):
        atlas.paste(frame, (tile % COLUMNS * SIZE, tile // COLUMNS * SIZE))
    atlas.save(ART / "交互图集.webp", lossless=True, method=5, exact=True)
    (ART / "交互时间轴.json").write_text(
        json.dumps(timeline, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if args.preview:
        pause = [(idle, 590)]
        write_preview(args.preview, (pause, enter, sway, sway, settle, pause, tap, pause, mad, pause))
    print(f"Built {len(segments)} reaction clips / {len(frames)} frames.")


if __name__ == "__main__":
    main()
