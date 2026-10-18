# DUALDEV

**One AI. Two superpowers. Build and fix.**
From idea to application. From error to solution.

DUALDEV is an AI software-engineering workspace. You describe an app in plain
English. DUALDEV generates the source code and tests, runs them in an isolated
**CreateOS sandbox**, reads the real failure output, patches the faulty code,
and re-runs the tests to check the repair. It reports what passed and what is
still broken. It never claims a fix it hasn't re-run.

```
IDEA → GENERATE → EXECUTE → DETECT → REPAIR → VERIFY
```

## The problem

Code generators stop at "here is some code". Nobody runs it, and when it breaks
you're on your own. DUALDEV closes the loop: it runs what it builds, and when a
test fails, it fixes the failure using the actual sandbox output and proves the
fix by re-running the tests.

## Two capabilities

| | What it does | Evidence it records |
|---|---|---|
| **Build** | Spec → plan → files (app + `node:test` suite), validated against a stack contract, then synced into a CreateOS sandbox | file list, plan, limitations |
| **Fix** | Failing run → failure classification → model gets the real errors + relevant files → validated patch → re-run in sandbox. Max 3 attempts | before/after diff, root-cause hypothesis, verification run (command, exit code, TAP summary) |

Success states are tracked **separately**: code generated, compiles
(`node --check`), app starts (`GET /` → 200), unit tests pass (`node --test`),
behaviour verified by E2E (**not implemented, always shown as "—"**), and
preview available.

## Architecture

```
src/
  app/                     Next.js 15 App Router (UI + API routes)
    api/projects/…         create / list / get / delete
    api/projects/[id]/[action]  build | test | fix | demo | preview | preview-stop | reset | cancel
    api/status             which integrations are configured (booleans only)
  components/              Dashboard, Workspace (files, code, repairs+diffs, preview, tests, pipeline, activity)
  lib/
    agent/orchestrator.ts  job runner, state machine, bounded repair loop, per-project lock
    agent/builder.ts       generation + validation of model output
    agent/bug-hunter.ts    context selection, repair validation (no test tampering), patch apply
    agent/verifier.ts      approved check commands: sync → node --version → node --check → node --test → startup smoke
    ai/groq.ts             Groq (OpenAI-compatible chat completions, strict json_schema output)
    ai/provider.ts         model interface + Anthropic Messages API alternative
    ai/prompts.ts          build + repair prompts
    sandbox/createos.ts    CreateOS SDK adapter (@nodeops-createos/sandbox)
    tests/runner.ts        TAP parser + failure classifier
    security/validation.ts path / id / size validation, log truncation + redaction
    projects/store.ts      file-backed JSON persistence (.data/projects/*.json, atomic writes)
fixtures/task-manager/     prebuilt demo app with one real defect
scripts/sandbox-check.ts   standalone CreateOS connectivity check
tests/                     vitest suite
```

**Generated-app stack (deliberately narrow):** zero-dependency ES modules on
Node 20+, `node:test` for tests, and a tiny `node:http` static server for the
preview. The sandbox doesn't need `npm install` or general network egress, so
runs are fast and repeatable.

**Sandbox lifecycle:** one CreateOS sandbox per project (`s-1vcpu-1gb`,
`devbox:1`). It's created on first use, reused for later runs, auto-paused after
10 minutes idle, resumed on demand, and destroyed when the project is deleted.
Egress is pinned to a narrow allowlist. Every command is wrapped in `timeout`,
and the HTTP call has its own timeout.

## Required credentials

| Variable | Purpose |
|---|---|
| `CREATEOS_SANDBOX_API_KEY` | CreateOS Sandbox API key (required for any execution) |
| `CREATEOS_SANDBOX_BASE_URL` | optional, defaults to `https://api.sb.createos.sh` |
| `GROQ_API_KEY` | Groq API key: the default model provider for Build and Fix |
| `GROQ_MODEL` | optional, default `openai/gpt-oss-120b` (needs strict JSON-schema support; other models fall back to JSON mode) |
| `DUALDEV_MODEL_PROVIDER` | optional, `groq` or `anthropic`. Without it, Groq is used if `GROQ_API_KEY` is set |
| `ANTHROPIC_API_KEY` | alternative provider: Claude API key |
| `ANTHROPIC_MODEL` | optional, default `claude-opus-5-5` |
| `ANTHROPIC_EFFORT` | optional, `low`/`medium`/`high`, default `medium` |
| `DUALDEV_DISABLE_FALLBACKS` | set `1` to turn off server-side refusal fallbacks (on by default) |
| `CREATEOS_PREVIEW_SCHEME` | `http` (default, per SDK tutorial) or `https` |
| `DUALDEV_DATA_DIR` | optional, default `./.data` |

Copy `.env.example` to `.env.local` and fill it in. Keys are read only on the
server. The browser only sees whether each integration is configured.
DUALDEV pins the Anthropic base URL to `https://api.anthropic.com` (override
with `DUALDEV_ANTHROPIC_BASE_URL`), so an unrelated `ANTHROPIC_BASE_URL` in your
shell never receives the key.

## Setup

```bash
npm install
cp .env.example .env.local      # add CREATEOS_SANDBOX_API_KEY and GROQ_API_KEY
npm run sandbox:check           # CreateOS proof: new sandbox → python3 program → output → destroy
npm run build && npm start      # http://127.0.0.1:3000  (or: npm run dev)
npm test                        # vitest suite
```

### CreateOS setup

1. Get a CreateOS Sandbox API key (createos.sh → Sandbox). See the
   [Sandbox quickstart](https://createos.sh/docs/Sandbox/Quickstart/).
2. Put it in `.env.local` as `CREATEOS_SANDBOX_API_KEY`.
3. Make sure the host running DUALDEV can reach `api.sb.createos.sh:443`.
4. Run `npm run sandbox:check`, or click **Run proof** on the dashboard. It
   creates a fresh sandbox, uploads and runs a Python program with `python3`,
   records stdout, stderr, the exit code and timing, and puts the
   control-plane metadata (account, sandbox id, shape, rootfs, region, IP) and
   the guest's hostname and kernel next to this server's hostname. It then
   destroys the sandbox. The program's output is deterministic
   (`primes below 10000: 1229 sum: 5736396`), so you can check it by hand.
   The last result is saved in `.data/proof.json` and shown in the UI.
5. **Behind an egress proxy** (e.g. a cloud dev container): DUALDEV routes SDK
   traffic through `HTTPS_PROXY` automatically (the SDK's own connection pool
   ignores it). If the proxy re-signs TLS, set `NODE_EXTRA_CA_CERTS` to its CA
   bundle.

The official `@nodeops-createos/cli` handles CreateOS *deployments*
(`init`/`deploy`/`logs`) and has no sandbox commands. Sandboxes are driven
through the official SDK, `@nodeops-createos/sandbox`, which is what DUALDEV
uses.

### Stripe Projects setup

The hackathon expects the stack to be provisioned with **Stripe Projects**
(Stripe CLI). The CLI wasn't available in the build environment, so this
step hasn't been done yet. On a machine with the Stripe CLI:

```bash
stripe login
stripe projects --help      # check the current command set first
# follow the hackathon instructions to init the project and add the CreateOS
# provider; the resulting CreateOS credentials go into .env.local
```

DUALDEV doesn't take payments. There are no Stripe products, prices or
checkout flows, and none should be added for the demo.

## Running the demo (≈90 seconds)

The demo uses a **prebuilt fixture**: a zero-dependency task manager whose
`toggleTask()` flips `task.completed` but never updates the dashboard counters.
The code wasn't generated live, and the UI labels it as a fixture. Everything
after loading **runs live**: sandbox execution, the failing assertion,
the model's investigation and patch, and the verification re-run.

1. Open `http://127.0.0.1:3000` and click **Run Build → Break → Fix demo**.
2. The workspace opens and the pipeline goes through *Preparing sandbox →
   Executing → Running tests*. The result is **5 passed, 1 failed**. The
   failing test is "completing a task moves it from the pending counter to the
   completed counter", with the real `deepStrictEqual` diff.
3. *Investigating → Applying repair*: the model gets that output and
   `src/tasks.js`. A validated patch is applied, and `src/tasks.js` gets an **M**.
4. *Verifying*: the full suite re-runs in the same sandbox. The activity feed
   reports whether the originally failing test now passes.
5. Open the **Repairs** tab to see the original failure, the root-cause
   hypothesis, the diff, and before/after pass counts. The run selector in
   **Test results** shows every run's commands, exit codes and raw output.
6. **Run demo again** restores the bug and repeats the whole flow.

### 90-second script

- **0–10s:** "Code generators hand you code and walk away. DUALDEV builds it, runs it, and fixes what fails, and it shows you the evidence."
- **10–25s:** Type a spec (or pick *Task manager*) and click **Build it**. Show the generated files. Or, for a deterministic demo, click **Run Build → Break → Fix demo** and say that the fixture is prebuilt.
- **25–40s:** Pipeline: sandbox → `node --check` → `node --test`. Point at **5 passed, 1 failed** and the sandbox id.
- **40–55s:** Open the failing test: the expected vs actual counters. "That's real output from the CreateOS sandbox, not a model guess."
- **55–75s:** Investigating → Applying repair → Verifying. Open **Repairs** and show the two-line diff in `toggleTask`.
- **75–90s:** **6/6 passing** after the re-run. Show the verification checklist, and note that E2E behaviour is honestly marked as not checked.

## What's implemented

- Natural-language → validated multi-file project (stack contract, path
  allowlist, zero-dependency check, required files, at least one test file;
  one automatic regeneration if validation fails).
- CreateOS execution via the official SDK: create/reconnect/resume, upload,
  exec with timeouts, ingress preview, destroy.
- Real checks: syntax check, test run with a TAP parser, startup smoke test.
- Failure classification: syntax, import resolution, missing dependency,
  runtime exception, failing assertion, startup failure, timeout,
  configuration error.
- Bounded repair loop (3 attempts) with validated patches. Repairs **can't
  modify existing tests** and can't create non-test files. Each attempt is
  verified by a fresh sandbox run.
- Per-project job lock, cancellation, and recovery from an interrupted job
  after a server restart.
- Persistent projects, run history, repair history with diffs, activity feed.

## Verification status (be precise)

| Claim | Status |
|---|---|
| Unit tests (path validation, model-output validation, TAP parsing, classification, repair limits, test-tamper rejection, concurrency lock, reset) | **Pass** (`npm test`) |
| Pipeline end-to-end with **test doubles** (a local temp-dir executor running only this repo's fixture, plus a scripted model patch) | **Pass.** Exercises the real verifier commands, TAP parsing and repair loop |
| CreateOS sandbox execution | **Not yet verified.** The build environment has no `CREATEOS_SANDBOX_API_KEY`, and its egress proxy refuses `CONNECT api.sb.createos.sh:443` (policy denial, confirmed in the proxy log). The proxy-aware client was confirmed to reach allowed hosts. Run `npm run sandbox:check` or the dashboard proof to verify |
| Live model generation / repair | **Not yet verified.** No `GROQ_API_KEY`, and `api.groq.com` is also blocked by the build environment's network policy. The Groq client is unit-tested against a mocked transport only |
| Preview via CreateOS ingress | Implemented per SDK docs, **not verified** |

The test doubles live only in `tests/`. The product never executes generated
code on the host.

## Known limitations

- One supported generated-app stack: zero-dependency JS + `node:test`. No
  React/Vite generation yet.
- "Behaviour verified" means unit tests only. There's no browser E2E harness.
- Single-node, single-user demo. No authentication. The server binds to
  `127.0.0.1` by default. **Don't expose it publicly as is**: anyone who can
  reach it can spend your CreateOS and Anthropic credits.
- File-backed persistence, not a database.
- Job progress is polled (1s while busy), not streamed.
- When a repair is unresolved, the last attempted patch stays applied. Use
  **Reset** to restore the original files.

## Security notes

- Generated code runs only inside CreateOS sandboxes, never on the host.
- Model output never chooses commands. The sandbox only runs a fixed set of
  approved scripts (`node --check`, `node --test`, startup smoke, preview
  server).
- Every model-supplied path is validated: no absolute paths, `..`, dotfiles,
  `node_modules`, or disallowed extensions. Sizes and counts are bounded.
- Project ids are validated before they touch the filesystem.
- Logs are truncated and scrubbed of anything shaped like a key. No secrets
  are sent to the sandbox or included in prompts.
- Preview ingress is opt-in per project and can be turned off.

## Recording a demo video

`scripts/demo/record.mjs` drives the **real deployed site** in Chromium (prompt → build → preview → evidence → Bug Hunter → Stripe Checkout with the test card → verified success page) and renders `demo-output/dualdev-demo.mp4` with burned-in captions, a voiceover from the OS's built-in text-to-speech (Windows SAPI, macOS `say`, or `espeak-ng`), synthesized background music and click sounds. Whatever the live site does, failures included, is what gets recorded.

```bash
npx playwright install chromium   # once
npm run demo:record -- --url https://your-app.vercel.app
# options: --prompt "…"  --scan https://site.com  --no-pay  --no-voice  --out dir
```

The card is only submitted when Stripe Checkout shows test mode.
