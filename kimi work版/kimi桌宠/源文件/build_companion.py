from argparse import ArgumentParser
from base64 import b64encode
from io import BytesIO
import json
from pathlib import Path
import shutil


SOURCE = Path(__file__).resolve().parent
ART = SOURCE / "素材"
DEFAULT_OUTPUT = SOURCE.parent / "桌宠运行包"
SIZE, COLUMNS = 320, 12


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def check_timeline(clips):
    offset = 0
    for name, clip in clips.items():
        durations = clip["ms"]
        if (clip["offset"] != offset or clip["count"] != len(durations)
                or not durations or any(type(ms) is not int or ms <= 0 for ms in durations)):
            raise ValueError(f"Invalid timeline for {name}")
        offset += len(durations)
    if not offset:
        raise ValueError("No clips in the atlas.")
    return offset


def build_from_png(root):
    from PIL import Image

    clips, files = {}, []
    mapping = read_json(root / "桌宠状态映射.json")
    for name, clip in mapping["clips"].items():
        folder = root / clip["directory"]
        timing = read_json(folder / clip["timing_file"])
        if "frame_ms" in timing:
            durations = timing["frame_ms"]
            pattern = clip.get("frame_pattern", "{index:02d}.png")
            names = [pattern.format(index=index) for index in range(len(durations))]
        else:
            durations = [row["ms"] for row in timing["frames"]]
            names = [row["file"] for row in timing["frames"]]
        clips[name] = {"offset": len(files), "count": len(names), "ms": durations}
        files.extend(folder / name for name in names)

    count = check_timeline(clips)
    rows = (count + COLUMNS - 1) // COLUMNS
    atlas = Image.new("RGBA", (SIZE * COLUMNS, SIZE * rows))
    for index, file in enumerate(files):
        with Image.open(file) as image:
            cel = image.convert("RGBA").resize((SIZE, SIZE), Image.Resampling.LANCZOS)
        atlas.alpha_composite(cel, ((index % COLUMNS) * SIZE, (index // COLUMNS) * SIZE))
    payload = BytesIO()
    atlas.save(payload, format="WEBP", quality=88, method=6, exact=True)
    return payload.getvalue(), clips


def main():
    parser = ArgumentParser(description="Build the Kimi Work pet package from its bundled atlas.")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT,
                        help="Destination directory for pet.js and pet.json.")
    parser.add_argument("--asset-root", type=Path,
                        help="Optional v3 PNG project root. This mode requires Pillow.")
    args = parser.parse_args()
    if args.asset_root is None:
        atlas = (ART / "atlas.webp").read_bytes()
        clips = read_json(ART / "片段时间轴.json")
    else:
        atlas, clips = build_from_png(args.asset_root.resolve())

    reactions = read_json(ART / "交互时间轴.json")
    reaction_atlas = (ART / "交互图集.webp").read_bytes()
    count = check_timeline(clips) + check_timeline(reactions)
    if clips.keys() & reactions.keys():
        raise ValueError("Duplicate clip names across atlases.")
    clips.update({name: dict(clip, atlas="reaction") for name, clip in reactions.items()})
    for payload in (atlas, reaction_atlas):
        if payload[:4] != b"RIFF" or payload[8:12] != b"WEBP":
            raise ValueError("The source atlas is not a WebP file.")
    template = (SOURCE / "pet-runtime.template.js").read_text(encoding="utf-8")
    replacements = {
        "__ATLAS__": json.dumps("data:image/webp;base64," + b64encode(atlas).decode("ascii")),
        "__REACTION_ATLAS__": json.dumps("data:image/webp;base64," + b64encode(reaction_atlas).decode("ascii")),
        "__CLIPS__": json.dumps(clips, separators=(",", ":")),
    }
    for marker, value in replacements.items():
        if template.count(marker) != 1:
            raise ValueError(f"Expected one {marker} placeholder.")
        template = template.replace(marker, value)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / "pet.js").write_text(template, encoding="utf-8", newline="\n")
    manifest = read_json(ART / "pet.json")
    if manifest["three"]["file"] != "pet.js":
        raise ValueError("Unexpected runtime entry in pet.json.")
    shutil.copyfile(ART / "pet.json", args.output_dir / "pet.json")
    print(f"Built {len(clips)} clips / {count} frames into {args.output_dir}")


if __name__ == "__main__":
    main()
