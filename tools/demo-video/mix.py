"""Turns a recorded take (tutorial.mjs / walkthrough.mjs) into finished videos: marked waits sped up, narration placed on the
remapped timeline (one track, loudness-normalised), upscaled to 1080p. Writes <name>-master.mp4 (the whole take), one clip +
.srt per part (parts/NN-<slug>), and one video + .srt with chapter markers per version: <name>.mp4 (parts in set "full")
and <name>-short.mp4 (set "short", if any). Usage: python3 tools/demo-video/mix.py [out dir]   (default tools/demo-video/out)"""
import array, json, subprocess, sys, wave
from pathlib import Path

out = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).parent / "out").resolve()   # absolute: the concat list resolves paths from its own folder
tl = json.loads((out / "timeline.json").read_text())

# Piecewise timeline: normal speed except each sped-up wait, squeezed to a few seconds.
segs, cur = [], 0.0
for f in sorted(tl["ff"], key=lambda f: f["start"]):
    a, b = f["start"] / 1000, f["end"] / 1000
    if b - a < 0.5:
        continue
    if a > cur:
        segs.append((cur, a, 1.0))
    d = b - a
    target = min(d, 2.5 + d / 25)          # ponytail: login 7 s -> 2.8 s, 60 s -> 4.9 s, 5 min -> 14.5 s; tune here
    segs.append((a, b, d / target))
    cur = b
segs.append((cur, None, 1.0))
(out / "segments.json").write_text(json.dumps(segs))   # review.py uses the same timing


def remap(t: float) -> float:
    """Recorded time (s) -> output time (s)."""
    o = 0.0
    for a, b, k in segs:
        if b is None or t <= b:
            return o + (max(t, a) - a) / k
        o += (b - a) / k
    return o


def ts(t: float) -> str:
    ms = int(round(max(t, 0) * 1000))
    return f"{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02},{ms % 1000:03}"


def chapter_title(p) -> str:
    return p["title"] if p.get("plain") or p["n"] == 0 else f"{tl.get('unit', 'Part')} {p['n']} · {p['title']}"


def srt(says, shift=0.0) -> str:
    return "\n".join(f"{i}\n{ts(remap(s['at'] / 1000) - shift)} --> {ts(remap(s['at'] / 1000) - shift + s['seconds'])}\n{s['text']}\n"
                     for i, s in enumerate(says, start=1))


vf = [f"[0:v]trim=start={a}" + (f":end={b}" if b is not None else "") + f",setpts=(PTS-STARTPTS)/{k}[v{i}]"
      for i, (a, b, k) in enumerate(segs)]
vf.append("".join(f"[v{i}]" for i in range(len(segs))) + f"concat=n={len(segs)}:v=1:a=0,fps=30,scale=1920:1080:flags=lanczos[v]")
# One narration track (stdlib): every clip summed in at its remapped time. ffmpeg then joins just two inputs
# (an amix over ~190 inputs runs out of filter queue space).
rate = None
for s in tl["says"]:
    with wave.open(s["file"]) as w:
        assert w.getnchannels() == 1 and w.getsampwidth() == 2 and rate in (None, w.getframerate()), s["file"]
        rate = w.getframerate()
        s["pcm"] = array.array("h", w.readframes(w.getnframes()))
track = array.array("h", bytes(2 * int((remap(tl["end"] / 1000) + 2) * rate)))
for s in tl["says"]:
    o = int(remap(s["at"] / 1000) * rate)
    for i, v in enumerate(s.pop("pcm")):
        if o + i < len(track):
            track[o + i] = max(-32768, min(32767, track[o + i] + v))
narration = out / "narration.wav"
with wave.open(str(narration), "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate); w.writeframes(track.tobytes())

stem = tl.get("name", "reed-tutorial")
enc = ["-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart"]
ff = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error"]
end = remap(tl["end"] / 1000)
parts = tl["parts"]
bounds = [(remap(p["start"] / 1000), remap(parts[i + 1]["start"] / 1000) if i + 1 < len(parts) else end) for i, p in enumerate(parts)]

# 1. The master: the whole take, waits sped up, upscaled, narration loudness-normalised (web standard -16 LUFS).
master = out / f"{stem}-master.mp4"
subprocess.run([*ff, "-i", tl["video"], "-i", str(narration), "-filter_complex", ";".join(vf) + ";[1:a]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[a]",
                "-map", "[v]", "-map", "[a]", *enc, "-shortest", str(master)], check=True)

# 2. One clip per part, cut at the part title cards.
pdir = out / "parts"
pdir.mkdir(exist_ok=True)
clips = []
for p, (a, b) in zip(parts, bounds):
    clip = pdir / f"{p['n']:02}-{p['slug']}.mp4"
    subprocess.run([*ff, "-ss", f"{a:.3f}", "-to", f"{b:.3f}", "-i", str(master), *enc, str(clip)], check=True)
    clip.with_suffix(".srt").write_text(srt([s for s in tl["says"] if a <= remap(s["at"] / 1000) < b], shift=a))
    clips.append(clip)
    print(f"  parts/{clip.name}  {(b - a) / 60:.1f} min  {p['title']}")


# 3. Each version joins its parts (sets: "full", "short"), with chapter markers and captions.
def version(name: str, path: Path):
    sel = [(p, ab, c) for p, ab, c in zip(parts, bounds, clips) if name in p.get("sets", ["full"])]
    if not sel:
        return
    listing, meta, subs, t = path.with_suffix(".txt"), path.with_suffix(".chapters"), [], 0.0
    listing.write_text("".join(f"file '{c}'\n" for _, _, c in sel))
    chapters = ";FFMETADATA1\n"
    for p, (a, b), _ in sel:
        chapters += f"[CHAPTER]\nTIMEBASE=1/1000\nSTART={int(t * 1000)}\nEND={int((t + b - a) * 1000)}\ntitle={chapter_title(p)}\n"
        subs += [(remap(s["at"] / 1000) - a + t, s) for s in tl["says"] if a <= remap(s["at"] / 1000) < b]
        t += b - a
    meta.write_text(chapters)
    subprocess.run([*ff, "-f", "concat", "-safe", "0", "-i", str(listing), "-i", str(meta), "-map", "0", "-map_chapters", "1",
                    "-c", "copy", "-movflags", "+faststart", str(path)], check=True)
    path.with_suffix(".srt").write_text("\n".join(f"{i}\n{ts(st)} --> {ts(st + s['seconds'])}\n{s['text']}\n" for i, (st, s) in enumerate(subs, start=1)))
    listing.unlink(); meta.unlink()
    print(f"{path} ({t / 60:.1f} min, {len(sel)} chapters)")


version("full", out / f"{stem}.mp4")
version("short", out / f"{stem}-short.mp4")
