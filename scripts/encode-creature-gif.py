"""Encode native canvas frames. Install tools locally with:
python -m pip install --target verify-out/gif-tools Pillow
"""
import base64
import io
import json
from pathlib import Path
import sys

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "verify-out" / "gif-tools"))
from PIL import Image, ImageChops  # noqa: E402

source = Path(sys.argv[1]).resolve()
target = Path(sys.argv[2]).resolve()
if not target.is_relative_to(REPO / "screenshots"):
    raise ValueError("Creature GIF output must stay in the ignored screenshots directory")
data = json.loads(source.read_text(encoding="utf-8"))
frames = [Image.open(io.BytesIO(base64.b64decode(frame))).convert("RGB") for frame in data["frames"]]
# One shared palette avoids flickering colors between states. No dithering or
# interpolation is applied to the game's half-cell pixels.
samples = frames[::max(1, len(frames) // 16)][:16]
swatches = Image.new("RGB", (frames[0].width * 4, frames[0].height * 4))
for i, frame in enumerate(samples):
    swatches.paste(frame, (i % 4 * frame.width, i // 4 * frame.height))
palette = swatches.quantize(colors=256, method=Image.Quantize.MEDIANCUT)
indexed = [frame.quantize(palette=palette, dither=Image.Dither.NONE) for frame in frames]
target.parent.mkdir(parents=True, exist_ok=True)
indexed[0].save(target, save_all=True, append_images=indexed[1:], duration=50, loop=0, optimize=False, disposal=1,
                comment=b"Native creature pose fixtures at 60 simulation ticks / 20 GIF frames per second")
frames[0].save(target.with_suffix(".png"))
with Image.open(target) as result:
    duration = 0
    for i in range(result.n_frames):
        result.seek(i)
        duration += result.info.get("duration", 0)
    if duration != len(frames) * 50 or result.n_frames < 20:
        raise ValueError("Encoded animation lost its duration or motion")
    meta = {"frames": result.n_frames, "durationMs": duration, "width": result.width, "height": result.height,
            "loop": result.info.get("loop"), "bytes": target.stat().st_size}
errors = [ImageChops.difference(original, encoded.convert("RGB")).getextrema() for original, encoded in zip(samples, indexed[::max(1, len(frames) // 16)][:16])]
meta["sampledMaxChannelError"] = max(channel[1] for error in errors for channel in error)
target.with_suffix(".json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
print(json.dumps(meta))
