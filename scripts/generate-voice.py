"""
Generates narration clips (one MP3 per sentence) from scripts/lines.json using Microsoft neural voices
via edge-tts, and writes public/audio/manifest.json.

Usage (from the project root):
    node scripts/dump-lines.mjs
    python scripts/generate-voice.py                       # default calm voice
    python scripts/generate-voice.py --voice en-GB-RyanNeural --rate -25% --pitch -12Hz
    python scripts/generate-voice.py --only s1.open        # regenerate one line
    python scripts/generate-voice.py --missing             # only lines that have no clips yet
"""
import argparse
import asyncio
import json
import pathlib

import edge_tts

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "audio"


async def synth(text: str, path: pathlib.Path, voice: str, rate: str, pitch: str) -> None:
    for attempt in range(3):
        try:
            await edge_tts.Communicate(text, voice, rate=rate, pitch=pitch).save(str(path))
            return
        except Exception as e:  # network hiccup
            if attempt == 2:
                raise
            print(f"  retry ({e})")
            await asyncio.sleep(1.5)


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", default="en-US-AndrewNeural")
    ap.add_argument("--rate", default="-24%")  # the settings the approved Story 1 narration was made with
    ap.add_argument("--pitch", default="-14Hz")
    ap.add_argument("--only", default=None, help="only regenerate this line id")
    ap.add_argument("--missing", action="store_true", help="only lines with no clips in the manifest; keeps every existing clip")
    args = ap.parse_args()

    lines = json.loads((ROOT / "scripts" / "lines.json").read_text(encoding="utf8"))
    manifest_path = OUT / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig")) if manifest_path.exists() and (args.only or args.missing) else {}
    OUT.mkdir(parents=True, exist_ok=True)

    for line in lines:
        if args.only and line["id"] != args.only:
            continue
        if args.missing and line["id"] in manifest:
            continue
        d = OUT / line["id"]
        d.mkdir(parents=True, exist_ok=True)
        clips = []
        for i, sentence in enumerate(line["sentences"]):
            f = d / f"{i}.mp3"
            print(f'{line["id"]}[{i}] {sentence[:60]}')
            await synth(sentence, f, args.voice, args.rate, args.pitch)
            clips.append(f"{line['id']}/{i}.mp3")
        manifest[line["id"]] = clips

    if not args.missing or "_voice" not in manifest:
        manifest["_voice"] = {"voice": args.voice, "rate": args.rate, "pitch": args.pitch}
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf8")
    print(f"done: {sum(len(v) for k, v in manifest.items() if k != '_voice')} clips -> {OUT}")


asyncio.run(main())
