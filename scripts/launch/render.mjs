#!/usr/bin/env node
/**
 * Renders the DualDev launch video: a timeline-driven HTML animation captured
 * frame by frame (deterministic, smooth), plus synthesized music/SFX and a
 * female TTS voiceover, encoded to MP4.
 *
 *   node scripts/launch/render.mjs [--out demo-output] [--fps 30]
 */
import { chromium } from "playwright";
import ffmpegPath from "ffmpeg-static";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const OUT = path.resolve(opt("out", "demo-output"));
const FPS = Number(opt("fps", 30));
const DURATION = 24;
const WORK = path.join(OUT, "launch-work");
rmSync(WORK, { recursive: true, force: true });
mkdirSync(path.join(WORK, "frames"), { recursive: true });

// Voiceover lines and when they start (seconds), matched to the scenes in launch.html.
const VO = [
  [0.4, "Every idea deserves to ship."],
  [3.5, "Just describe it, in plain English."],
  [6.6, "DualDev builds it."],
  [9.9, "Runs it in a real CreateOS sandbox."],
  [13.4, "And fixes what fails. With proof."],
  [16.8, "One AI. Two superpowers."],
  [19.8, "DualDev. Build and fix. Live now."],
];

// ---------- frames ----------
console.log(`Rendering ${DURATION * FPS} frames…`);
const browser = await chromium.launch({ executablePath: process.env.DEMO_CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(pathToFileURL(path.join(here, "launch.html")).href);
await page.evaluate(() => document.fonts.ready);
for (let f = 0; f < DURATION * FPS; f++) {
  await page.evaluate((t) => window.render(t), f / FPS);
  await page.screenshot({ path: path.join(WORK, "frames", `f${String(f).padStart(5, "0")}.jpg`), type: "jpeg", quality: 92 });
  if (f % (FPS * 4) === 0) console.log(`  ${(f / FPS).toFixed(0)}s`);
}
await browser.close();

// ---------- voice ----------
console.log("Voiceover…");
const voice = [];
VO.forEach(([at, text], i) => {
  const txt = path.join(WORK, `vo${i}.txt`);
  const wav = path.join(WORK, `vo${i}.wav`);
  writeFileSync(txt, text);
  try {
    execFileSync("python3", [path.join(here, "..", "demo", "tts_espeak.py"), wav, txt, process.env.LAUNCH_VOICE || "en-us+Annie"], { stdio: "ignore" });
    voice.push({ at, wav });
  } catch {
    console.warn("  voiceover unavailable (pip install espeakng-loader)");
  }
});

// ---------- music + SFX + mix (numpy) ----------
console.log("Music and mix…");
const spec = path.join(WORK, "audio.json");
writeFileSync(spec, JSON.stringify({ duration: DURATION, voice, sceneCuts: [3.2, 6.2, 9.6, 13.1, 16.6, 19.4], typing: [3.7, 5.4], success: 15.2, fail: 11.75, hit: 19.4, pops: [0.5, 0.7, 0.9, 1.1, 1.3, 7.6, 10.1, 10.65, 11.2, 13.6, 13.95] }));
execFileSync("python3", [path.join(here, "audio.py"), spec, path.join(WORK, "mix.wav")], { stdio: "inherit" });

// ---------- encode ----------
console.log("Encoding MP4…");
mkdirSync(OUT, { recursive: true });
const final = path.join(OUT, "dualdev-launch.mp4");
const r = spawnSync(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", "-framerate", String(FPS), "-i", path.join(WORK, "frames", "f%05d.jpg"), "-i", path.join(WORK, "mix.wav"), "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", final], { encoding: "utf8" });
if (r.status !== 0) throw new Error(r.stderr);
console.log(`Done: ${final}`);
