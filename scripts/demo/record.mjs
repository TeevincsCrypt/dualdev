#!/usr/bin/env node
/**
 * DualDev demo recorder.
 *
 * Drives the REAL deployed DualDev site in a browser, records the screen, and
 * produces an MP4 with captions, a voiceover (the OS's built-in text-to-speech),
 * synthesized background music and click sounds. Nothing is faked: whatever the
 * live site does (including failures) is what gets recorded.
 *
 *   npx playwright install chromium        # once
 *   npm run demo:record -- --url https://your-app.vercel.app
 *
 * Options:
 *   --url <site>        deployed DualDev URL (required)
 *   --prompt <text>     what to build (default: a coffee-shop landing page)
 *   --scan <url>        website for the Bug Hunter (default: https://example.com)
 *   --no-pay            open Stripe Checkout but do not submit the test card
 *   --no-voice          skip the voiceover
 *   --out <dir>         output directory (default: demo-output)
 */
import { chromium } from "playwright";
import ffmpegPath from "ffmpeg-static";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

// ---------- options ----------
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);
const SITE = (opt("url") || "").replace(/\/+$/, "");
if (!/^https?:\/\//.test(SITE)) {
  console.error("Usage: npm run demo:record -- --url https://your-dualdev.vercel.app");
  process.exit(1);
}
const PROMPT = opt("prompt", "A modern landing page for a specialty coffee shop called Ember & Oak: hero with a call to action, menu with prices, testimonials, opening hours and a contact form.");
const SCAN_URL = opt("scan", "https://example.com");
const PAY = !flag("no-pay");
const VOICE = !flag("no-voice");
const OUT = path.resolve(opt("out", "demo-output"));
const W = 1280;
const H = 720;
const WORK = path.join(OUT, "work");
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

// ---------- script: narration per scene ----------
const SCENES = [
  { id: "intro", say: "This is DualDev. One AI, two superpowers: it builds apps from a prompt, and it hunts and fixes bugs, all verified in a real CreateOS sandbox." },
  { id: "features", say: "Generation and verification work together. Every check runs in an isolated sandbox, and every result comes with real evidence." },
  { id: "dashboard", say: "Let's open the workspace and describe what we want to build, in plain English." },
  { id: "prompt", say: "I'll ask for a landing page for a coffee shop, and hit Build." },
  { id: "building", say: "DualDev is now generating the code with the AI model. As soon as the files exist, the preview opens automatically." },
  { id: "preview", say: "Here is what it built. Let's view it full screen." },
  { id: "evidence", say: "Behind the scenes, the generated files were uploaded to a CreateOS sandbox, syntax checked and tested. These are the real execution results." },
  { id: "bughunt", say: "Now the Bug Hunter. Paste any website address, and DualDev fetches the page, runs automatic checks, and has the AI review its code." },
  { id: "findings", say: "Each finding has a severity, the evidence, and a suggested fix." },
  { id: "pricing", say: "Finally, monetization. DualDev Pro is sold through Stripe Checkout." },
  { id: "stripe", say: "Clicking upgrade opens a real Stripe Checkout session. This is test mode, so we pay with Stripe's test card." },
  { id: "success", say: "After payment, DualDev verifies the session with Stripe on the server before confirming the upgrade." },
  { id: "outro", say: "DualDev. Build and fix, with proof. Built for the CreateOS and Stripe hackathon." },
];

// ---------- helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ff = (args, label) => {
  const r = spawnSync(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", ...args], { cwd: WORK, encoding: "utf8", maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`ffmpeg (${label}) failed:\n${r.stderr}`);
};

/** Duration of a PCM WAV file in seconds (reads the RIFF header). */
function wavSeconds(file) {
  const b = readFileSync(file);
  let byteRate = 0;
  for (let i = 12; i < b.length - 8; ) {
    const id = b.toString("ascii", i, i + 4);
    const size = b.readUInt32LE(i + 4);
    if (id === "fmt ") byteRate = b.readUInt32LE(i + 16);
    if (id === "data") return byteRate ? size / byteRate : 0;
    i += 8 + size + (size % 2);
  }
  return 0;
}

/** Text-to-speech with the OS's built-in engine. Returns a 44.1 kHz mono WAV path, or null. */
function speak(text, id) {
  const txt = path.join(WORK, `${id}.txt`);
  const raw = path.join(WORK, `${id}.raw.wav`);
  const wav = path.join(WORK, `${id}.wav`);
  writeFileSync(txt, text);
  try {
    if (process.platform === "win32") {
      const ps = [
        "Add-Type -AssemblyName System.Speech;",
        "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;",
        "try { $s.SelectVoiceByHints([System.Speech.Synthesis.VoiceGender]::Female) } catch {}",
        "$s.Rate = 0;",
        `$s.SetOutputToWaveFile('${raw.replace(/'/g, "''")}');`,
        `$s.Speak([IO.File]::ReadAllText('${txt.replace(/'/g, "''")}'));`,
        "$s.Dispose();",
      ].join(" ");
      execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { stdio: "ignore" });
    } else if (process.platform === "darwin") {
      execFileSync("say", ["-o", raw.replace(/\.wav$/, ".aiff"), "-f", txt], { stdio: "ignore" });
      ff(["-i", raw.replace(/\.wav$/, ".aiff"), raw], "aiff");
    } else {
      execFileSync("espeak-ng", ["-s", "165", "-w", raw, "-f", txt], { stdio: "ignore" });
    }
    ff(["-i", raw, "-ar", "44100", "-ac", "1", wav], "normalize voice");
    return wav;
  } catch {
    return null;
  }
}

// ---------- 1. voiceover first, so each scene lasts as long as its narration ----------
const narration = {};
let voiceOk = false;
if (VOICE) {
  console.log("Generating voiceover…");
  for (const s of SCENES) {
    const wav = speak(s.say, s.id);
    narration[s.id] = wav ? { wav, secs: wavSeconds(wav) } : { wav: null, secs: s.say.split(" ").length / 2.6 };
    voiceOk ||= Boolean(wav);
  }
  if (!voiceOk) console.warn("No text-to-speech engine found; continuing without voiceover (captions still added).");
} else {
  for (const s of SCENES) narration[s.id] = { wav: null, secs: s.say.split(" ").length / 2.6 };
}

// ---------- 2. record the real site ----------
console.log(`Recording ${SITE} …`);
const browser = await chromium.launch({ executablePath: process.env.DEMO_CHROMIUM || undefined });
const context = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: WORK, size: { width: W, height: H } } });
// Visible cursor (videos do not capture the OS cursor).
await context.addInitScript(() => {
  addEventListener("DOMContentLoaded", () => {
    const d = document.createElement("div");
    d.style.cssText = "position:fixed;z-index:2147483647;width:18px;height:18px;border-radius:50%;background:rgba(79,111,91,.55);border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.25);pointer-events:none;transform:translate(-50%,-50%);transition:transform .08s;left:-40px;top:-40px";
    document.documentElement.appendChild(d);
    addEventListener("mousemove", (e) => { d.style.left = e.clientX + "px"; d.style.top = e.clientY + "px"; }, true);
    addEventListener("mousedown", () => (d.style.transform = "translate(-50%,-50%) scale(.7)"), true);
    addEventListener("mouseup", () => (d.style.transform = "translate(-50%,-50%)"), true);
  });
});
const page = await context.newPage();
const t0 = Date.now();
const now = () => (Date.now() - t0) / 1000;
const marks = []; // { id, start, secs }
const clicks = [];
const log = (...a) => console.log(`[${now().toFixed(1)}s]`, ...a);

async function moveTo(locator) {
  const box = await locator.boundingBox();
  if (!box) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 18 });
}
async function click(locator) {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await moveTo(locator);
  clicks.push(now());
  await locator.click();
}
async function type(locator, text) {
  await click(locator);
  await page.keyboard.type(text, { delay: 28 });
}
async function smoothScroll(px, steps = 12) {
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, px / steps);
    await sleep(60);
  }
}
/** Waits until either the success or the failure locator appears. */
async function outcome(ok, fail, timeout) {
  const r = await Promise.race([
    ok.waitFor({ timeout }).then(() => "ok"),
    fail.waitFor({ timeout }).then(() => "fail"),
  ]).catch(() => "timeout");
  if (r !== "ok") log(`  outcome: ${r}${r === "fail" ? ` (${(await fail.first().innerText().catch(() => "")).slice(0, 160)})` : ""}`);
  return r;
}

/** Runs a scene and keeps it on screen at least as long as its narration. */
async function scene(id, fn) {
  const start = now();
  marks.push({ id, start, secs: narration[id].secs });
  log("scene", id);
  try {
    await fn();
  } catch (e) {
    log(`scene ${id} did not complete: ${e.message.split("\n")[0]}`);
  }
  const left = start + narration[id].secs + 0.7 - now();
  if (left > 0) await sleep(left * 1000);
}

let projectUrl = null;
await scene("intro", async () => {
  await page.goto(`${SITE}/`, { waitUntil: "networkidle" });
  await page.mouse.move(W / 2, H / 2);
});
await scene("features", async () => {
  await smoothScroll(700);
  await sleep(1500);
  await smoothScroll(700);
});
await scene("dashboard", async () => {
  await page.goto(`${SITE}/`, { waitUntil: "networkidle" });
  await click(page.getByRole("link", { name: "Open DualDev" }).first());
  await page.waitForURL(/\/app/, { timeout: 20_000 });
  await page.waitForLoadState("networkidle");
});
await scene("prompt", async () => {
  await type(page.locator("#spec"), PROMPT);
  await sleep(400);
  await click(page.getByRole("button", { name: "Build it" }));
  await page.waitForURL(/\/projects\//, { timeout: 30_000 });
  projectUrl = page.url();
});
await scene("building", async () => {
  // Wait for the real generation: the instant preview iframe appears once files exist.
  await outcome(page.locator('iframe[title="Instant preview"]'), page.getByText("Failed", { exact: true }), 180_000);
});
await scene("preview", async () => {
  const frame = page.locator('iframe[title="Instant preview"]');
  if (!(await frame.count())) throw new Error("no preview (the build did not produce files)");
  await click(page.getByRole("button", { name: /Full screen/ }));
  await sleep(1200);
  await page.mouse.move(W / 2, H / 2, { steps: 10 });
  for (let i = 0; i < 4; i++) {
    await smoothScroll(500, 10);
    await sleep(700);
  }
  await smoothScroll(-2000, 10);
  await sleep(500);
  await page.keyboard.press("Escape");
});
await scene("evidence", async () => {
  // Show the real sandbox results once the checks finish (or whatever state the job is in).
  await page.waitForFunction(() => !document.body.innerText.includes("Cancel"), null, { timeout: 150_000 }).catch(() => {});
  await click(page.getByRole("button", { name: "Code", exact: true }));
  await sleep(1500);
  const results = page.getByText("Sandbox executions").first();
  if (await results.count()) {
    await results.scrollIntoViewIfNeeded();
    await moveTo(results);
  }
});
await scene("bughunt", async () => {
  await page.goto(`${SITE}/app`, { waitUntil: "networkidle" });
  const input = page.getByPlaceholder("https://example.com");
  await input.scrollIntoViewIfNeeded();
  await type(input, SCAN_URL);
  await click(page.getByRole("button", { name: "Scan for bugs" }));
  await outcome(page.getByText(/^GET .* · \d+ findings?$/).first(), page.locator("section:has(input[placeholder='https://example.com']) p.text-bad").first(), 90_000);
});
await scene("findings", async () => {
  await smoothScroll(450);
  await sleep(1500);
  await smoothScroll(300);
});
await scene("pricing", async () => {
  await page.goto(`${SITE}/#pricing`, { waitUntil: "networkidle" });
  await page.locator("#pricing").scrollIntoViewIfNeeded();
  await moveTo(page.getByRole("button", { name: "Upgrade to Pro" }));
});
let onStripe = false;
await scene("stripe", async () => {
  await click(page.getByRole("button", { name: "Upgrade to Pro" }));
  const r = await Promise.race([
    page.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 }).then(() => "ok"),
    page.getByText(/Stripe unavailable|Checkout failed|Unknown plan/).first().waitFor({ timeout: 30_000 }).then(() => "fail"),
  ]).catch(() => "timeout");
  if (r !== "ok") throw new Error(`Stripe Checkout did not open (${r})`);
  onStripe = true;
  await page.waitForLoadState("networkidle");
  const testMode = /test mode|sandbox/i.test(await page.locator("body").innerText());
  if (!PAY || !testMode) {
    log(testMode ? "--no-pay: not submitting" : "Stripe is NOT in test mode: refusing to pay in the demo");
    return;
  }
  const fill = async (sel, value) => {
    const el = page.locator(sel).first();
    if (await el.count()) await type(el, value);
  };
  await fill("#email", "demo@dualdev.dev");
  await fill("#cardNumber", "4242424242424242");
  await fill("#cardExpiry", "1234");
  await fill("#cardCvc", "123");
  await fill("#billingName", "DualDev Demo");
  await fill("#billingPostalCode", "10001");
  const pay = page.locator(".SubmitButton, button[type=submit]").first();
  await click(pay);
});
await scene("success", async () => {
  if (!onStripe) return;
  if (PAY) await page.waitForURL(/\/billing\/success/, { timeout: 60_000 });
  await page.getByText(/Welcome to DualDev Pro|Checkout not completed|Could not verify/).first().waitFor({ timeout: 20_000 });
});
await scene("outro", async () => {
  await page.goto(`${SITE}/`, { waitUntil: "networkidle" });
  await page.mouse.move(W / 2, H / 3, { steps: 10 });
});

const total = now() + 0.5;
await sleep(500);
const video = page.video();
await context.close();
await browser.close();
const webm = await video.path();
renameSync(webm, path.join(WORK, "screen.webm"));
for (const f of readdirSync(WORK)) if (f.endsWith(".webm") && f !== "screen.webm") rmSync(path.join(WORK, f));
log(`recorded ${total.toFixed(1)}s`);

// ---------- 3. captions (SRT, one cue per sentence) ----------
const ts = (s) => {
  const ms = Math.max(0, Math.round(s * 1000));
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};
let srt = "";
let n = 0;
for (const m of marks) {
  const sentences = SCENES.find((s) => s.id === m.id).say.match(/[^.!?]+[.!?]+/g) ?? [];
  const totalChars = sentences.reduce((a, s) => a + s.length, 0);
  let t = m.start + 0.3;
  for (const s of sentences) {
    const d = (m.secs * s.length) / totalChars;
    srt += `${++n}\n${ts(t)} --> ${ts(t + d)}\n${s.trim()}\n\n`;
    t += d;
  }
}
writeFileSync(path.join(WORK, "captions.srt"), srt);

// ---------- 4. audio: voice + synthesized music + clicks ----------
console.log("Mixing audio…");
// Original ambient pad (A minor / F major, slow swells) generated mathematically: no licensing issues.
const chord = (a, b, gain, lfo) =>
  `${gain}*sin(2*PI*if(lt(mod(t\\,16)\\,8)\\,${a}\\,${b})*t)*(0.55+0.45*sin(2*PI*${lfo}*t))`;
const musicExpr = [chord(110, 87.31, 0.05, 0.07), chord(220, 174.61, 0.035, 0.11), chord(261.63, 261.63, 0.03, 0.09), chord(329.63, 349.23, 0.025, 0.13), chord(392, 440, 0.018, 0.05)].join("+");
ff(["-f", "lavfi", "-i", `aevalsrc=${musicExpr}:s=44100:d=${total.toFixed(2)}`, "-af", "lowpass=f=1600,aecho=0.8:0.7:120|240:0.3|0.2,afade=t=in:d=2,afade=t=out:st=" + Math.max(0, total - 3).toFixed(2) + ":d=3", "-ac", "1", "music.wav"], "music");
ff(["-f", "lavfi", "-i", "aevalsrc=0.6*sin(2*PI*1500*t)*exp(-55*t):s=44100:d=0.12", "click.wav"], "click");

const inputs = ["-i", "music.wav"];
const filters = ["[0:a]volume=0.55[m]"];
const mixes = ["[m]"];
let idx = 1;
for (const m of marks) {
  const wav = narration[m.id].wav;
  if (!wav) continue;
  inputs.push("-i", path.basename(wav));
  const ms = Math.round((m.start + 0.3) * 1000);
  filters.push(`[${idx}:a]adelay=${ms}|${ms},volume=1.6[v${idx}]`);
  mixes.push(`[v${idx}]`);
  idx++;
}
for (const c of clicks.slice(0, 40)) {
  inputs.push("-i", "click.wav");
  const ms = Math.round(c * 1000);
  filters.push(`[${idx}:a]adelay=${ms}|${ms},volume=0.5[c${idx}]`);
  mixes.push(`[c${idx}]`);
  idx++;
}
// Duck the music under the voice when there is one.
filters.push(`${mixes.join("")}amix=inputs=${mixes.length}:normalize=0:duration=first,alimiter=limit=0.95[out]`);
ff([...inputs, "-filter_complex", filters.join(";"), "-map", "[out]", "-t", total.toFixed(2), "audio.wav"], "mix");

// ---------- 5. final video: burned-in captions + audio ----------
console.log("Rendering MP4…");
mkdirSync(OUT, { recursive: true });
const final = path.join(OUT, "dualdev-demo.mp4");
const style = "FontName=Arial,FontSize=11,PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BackColour=&H99000000,BorderStyle=4,Outline=1,Shadow=0,MarginV=14";
try {
  ff(["-i", "screen.webm", "-i", "audio.wav", "-vf", `subtitles=captions.srt:force_style='${style}'`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-shortest", final], "render");
} catch (e) {
  console.warn("Burning captions failed; adding them as a subtitle track instead.", e.message.split("\n")[0]);
  ff(["-i", "screen.webm", "-i", "audio.wav", "-i", "captions.srt", "-map", "0:v", "-map", "1:a", "-map", "2:s", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-c:s", "mov_text", "-shortest", final], "render-soft-subs");
}
writeFileSync(path.join(OUT, "captions.srt"), srt);
console.log(`\nDone: ${final}`);
console.log(`Captions: ${path.join(OUT, "captions.srt")}${voiceOk ? "" : "  (no voiceover: no TTS engine available)"}`);
if (projectUrl) console.log(`Project recorded: ${projectUrl}`);
