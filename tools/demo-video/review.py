"""Viewer-experience check of a mixed tutorial: pacing per part (words/minute, caption length, dead air, speed-ups)
and one contact sheet per part (a frame per caption, to compare what is said with what is shown).
Usage: python3 tools/demo-video/review.py [out dir]  -> <out>/review/report.txt + <out>/review/NN-<slug>.png"""
import json, subprocess, sys, tempfile
from pathlib import Path

out = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).parent / "out").resolve()   # absolute: the concat list resolves paths from its own folder
tl = json.loads((out / "timeline.json").read_text())
rdir = out / "review"
master = out / f"{tl.get('name', 'reed-tutorial')}-master.mp4"   # the whole take, on the remapped timeline (mix.py)
rdir.mkdir(exist_ok=True)

segs = [tuple(x) for x in json.loads((out / "segments.json").read_text())]   # written by mix.py


def remap(t):
    o = 0.0
    for a, b, k in segs:
        if b is None or t <= b:
            return o + (max(t, a) - a) / k
        o += (b - a) / k
    return o


GOOD_WPM = (130, 165)
MAX_CAPTION = 110          # characters: about two lines at the caption width
MAX_SILENCE = 6.0          # seconds of nothing said, outside sped-up waits
MAX_SPEEDUP = 15.0
ffs = [(remap(f["start"] / 1000), remap(f["end"] / 1000)) for f in tl["ff"]]
says = sorted(tl["says"], key=lambda s: s["at"])
for s in says:
    s["t"] = remap(s["at"] / 1000)
end = remap(tl["end"] / 1000)
parts = tl["parts"]
lines, flags = [], []
for i, p in enumerate(parts):
    a = remap(p["start"] / 1000)
    b = remap(parts[i + 1]["start"] / 1000) if i + 1 < len(parts) else end
    ps = [s for s in says if a <= s["t"] < b]
    words = sum(len(s["text"].split()) for s in ps)
    spoken = sum(s["seconds"] for s in ps)
    wpm = words / spoken * 60 if spoken else 0
    lines.append(f"Part {p['n']} {p['title']}: {(b - a) / 60:.1f} min, {len(ps)} captions, {wpm:.0f} words/min while speaking, "
                 f"narration covers {spoken / (b - a) * 100:.0f}% of the time")
    if not GOOD_WPM[0] <= wpm <= GOOD_WPM[1]:
        flags.append(f"part {p['n']}: speaking rate {wpm:.0f} wpm outside {GOOD_WPM}")
    # dead air between consecutive captions, not counting sped-up waits
    prev = a
    for s in ps + [{"t": b, "text": "(end of part)"}]:
        gap = s["t"] - prev
        sped = any(fa < s["t"] and fb > prev for fa, fb in ffs)
        if gap > MAX_SILENCE and not sped:
            flags.append(f"part {p['n']}: {gap:.0f} s without narration before “{s['text'][:60]}” at {s['t'] / 60:.0f}:{s['t'] % 60:02.0f}")
        prev = s["t"] + s.get("seconds", 0)
    for s in ps:
        if len(s["text"]) > MAX_CAPTION:
            flags.append(f"part {p['n']}: caption of {len(s['text'])} chars (over {MAX_CAPTION}): “{s['text'][:60]}…”")
    # contact sheet: one frame 1.5 s into each caption
    with tempfile.TemporaryDirectory() as tmp:
        for j, s in enumerate(ps):
            subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-ss", f"{s['t'] + 1.5:.2f}", "-i", str(master),
                            "-frames:v", "1", "-vf", "scale=480:270", f"{tmp}/{j:03}.png"], check=True)
        rows = (len(ps) + 3) // 4
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", f"{tmp}/%03d.png", "-vf", f"tile=4x{rows}:padding=4:color=white",
                        "-frames:v", "1", str(rdir / f"{p['n']:02}-{p['slug']}.png")], check=True)
for f in tl["ff"]:
    d = (f["end"] - f["start"]) / 1000
    k = max((sk for sa, sb, sk in segs if sb is not None and abs(sa - f["start"] / 1000) < 0.01), default=1)
    if k > MAX_SPEEDUP:
        flags.append(f"sped-up wait “{f['label']}” runs {k:.0f}x: may read as a glitch")
report = "\n".join(lines + ["", f"{len(flags)} things to look at:"] + [f"  - {x}" for x in flags])
(rdir / "report.txt").write_text(report + "\n")
(rdir / "transcript.txt").write_text("\n".join(f"[{s['t'] // 60:02.0f}:{s['t'] % 60:04.1f}] {s['text']}" for s in says) + "\n")
print(report)
