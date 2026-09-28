"""Encode one creature's action clips: a GIF per action (caption band cropped
off) plus a captioned loop of every action, all on one shared palette so the
colours never flicker between clips. Prints a JSON summary on its last line.

Usage: python scripts/encode-creature-gifs.py <frames.json> <screenshots/.../creatures>
"""
import base64
import io
import json
from pathlib import Path
import sys

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "verify-out" / "gif-tools"))
from PIL import Image  # noqa: E402

FRAME_MS = 50  # every 3rd tick of the 60 Hz simulation: real time

source = Path(sys.argv[1]).resolve()
root = Path(sys.argv[2]).resolve()
if not root.is_relative_to(REPO / "screenshots"):
    raise ValueError("Creature GIF output must stay in the ignored screenshots directory")
data = json.loads(source.read_text(encoding="utf-8"))
kind, band = data["kind"], int(data["band"])
clips = [(a["id"], [Image.open(io.BytesIO(base64.b64decode(f))).convert("RGB") for f in a["frames"]]) for a in data["actions"]]

# One palette from frames sampled across every action.
samples = [frame for _, frames in clips for frame in frames[:: max(1, len(frames) // 4)][:4]]
w, h = samples[0].size
cols = 6
sheet = Image.new("RGB", (w * cols, h * ((len(samples) + cols - 1) // cols)))
for i, frame in enumerate(samples):
    sheet.paste(frame, (i % cols * w, i // cols * h))
palette = sheet.quantize(colors=255, method=Image.Quantize.MEDIANCUT)


def save(frames, target):
    indexed = [f.quantize(palette=palette, dither=Image.Dither.NONE) for f in frames]
    target.parent.mkdir(parents=True, exist_ok=True)
    indexed[0].save(target, save_all=True, append_images=indexed[1:], duration=FRAME_MS, loop=0, optimize=False, disposal=1)
    frames[len(frames) // 3].save(target.with_suffix(".png"))
    with Image.open(target) as result:
        # Identical consecutive frames (a corpse at rest) merge; time must not.
        duration = 0
        for i in range(result.n_frames):
            result.seek(i)
            duration += result.info.get("duration", 0)
        if duration != len(frames) * FRAME_MS:
            raise ValueError(f"{target.name}: encoder lost time ({duration} ms)")
    return {"frames": len(frames), "durationMs": len(frames) * FRAME_MS, "bytes": target.stat().st_size}


actions = {}
for action_id, frames in clips:
    cropped = [f.crop((0, 0, w, h - band)) for f in frames]
    actions[action_id] = save(cropped, root / kind / f"{action_id}.gif")
loop = save([f for _, frames in clips for f in frames], root / f"{kind}.gif")
print(json.dumps({**loop, "actions": actions}))
