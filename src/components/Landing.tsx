import { CheckoutButton } from "./CheckoutButton";
import { Logo } from "./ui";

const card = "rounded-[24px] border border-line bg-panel shadow-[0_1px_2px_rgba(0,0,0,0.03)]";

const STEPS = [
  { t: "Idea", d: "Describe the app or site in plain English." },
  { t: "Generate", d: "The model writes the page, logic and tests." },
  { t: "Execute", d: "Files run inside an isolated CreateOS sandbox." },
  { t: "Detect", d: "Syntax, tests and startup checks produce real output." },
  { t: "Repair", d: "Failures and code go back to the model for a patch." },
  { t: "Verify", d: "The suite re-runs. Green only after a real pass." },
];

const FEATURES = [
  { t: "AI app builder", d: "From a single prompt to a working, styled app with an instant in-browser preview." },
  { t: "Real sandbox execution", d: "Every check runs in a CreateOS VM sandbox — never on your machine." },
  { t: "Bug Hunter", d: "Investigates failing tests, patches the faulty code and re-runs to verify. Max 3 attempts." },
  { t: "Website scan", d: "Paste any URL for automatic checks plus an AI review of its HTML and scripts." },
  { t: "Evidence, not claims", d: "Commands, exit codes, stdout/stderr and before/after diffs for every run." },
  { t: "Honest by design", d: "Unresolved bugs are reported as unresolved. No fake green checks." },
];

export function Landing() {
  return (
    <div className="mx-auto max-w-6xl px-5 pb-16">
      <nav className="flex items-center justify-between py-6">
        <Logo href="/" />
        <div className="hidden items-center gap-7 text-[14px] text-muted md:flex">
          <a href="#features" className="hover:text-fg">Features</a>
          <a href="#how" className="hover:text-fg">How it works</a>
          <a href="#pricing" className="hover:text-fg">Pricing</a>
        </div>
        <a href="/app" className="rounded-full bg-accent px-5 py-2 text-[14px] font-medium text-white shadow-sm hover:bg-[#435f4e]">Open DualDev</a>
      </nav>

      {/* Hero */}
      <section className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
        <div className={`${card} p-8 sm:p-10`}>
          <span className="inline-flex items-center gap-2 rounded-full bg-[#e3ebe5] px-3 py-1 text-[12px] font-medium text-accent">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" /> Built on CreateOS sandboxes
          </span>
          <h1 className="mt-5 text-[40px] font-bold leading-[1.05] tracking-tight sm:text-[54px]">
            One AI.<br />Two superpowers.<br /><span className="text-accent">Build and fix.</span>
          </h1>
          <p className="mt-5 max-w-lg text-[16px] leading-relaxed text-muted">
            Describe an app. DualDev generates it, runs it in a real sandbox, tests what it built, and repairs what fails — then shows you the evidence.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <a href="/app" className="rounded-full bg-accent px-6 py-3 text-[15px] font-medium text-white shadow-sm hover:bg-[#435f4e]">Start building — free</a>
            <a href="#how" className="rounded-full border border-line bg-panel px-6 py-3 text-[15px] font-medium hover:bg-panel-2">See how it works</a>
          </div>
        </div>

        <div className="grid gap-4">
          <div className="rounded-[24px] bg-gradient-to-br from-[#5f8069] to-[#4f6f5b] p-6 text-white shadow-sm">
            <p className="text-[13px] text-white/75">Agent pipeline</p>
            <ol className="mt-3 grid grid-cols-3 gap-2 text-[13px]">
              {STEPS.map((s, i) => (
                <li key={s.t} className="rounded-2xl bg-white/12 px-3 py-2.5 backdrop-blur-sm">
                  <span className="text-white/60">{String(i + 1).padStart(2, "0")}</span>
                  <p className="font-semibold">{s.t}</p>
                </li>
              ))}
            </ol>
          </div>
          <div className={`${card} overflow-hidden`}>
            <div className="flex items-center justify-between border-b border-line px-5 py-3 text-[12px] text-muted">
              <span className="font-medium text-fg">src/tasks.js</span>
              <span>Illustration of the built-in demo bug and fix</span>
            </div>
            <pre className="mono overflow-x-auto px-5 py-4 text-[12px] leading-[1.7]">
              <span className="text-faint">  task.completed = !task.completed;{"\n"}</span>
              <span className="block bg-ok/10 text-ok">+ if (task.completed) {"{"} stats.pending--; stats.completed++; {"}"}</span>
              <span className="block bg-ok/10 text-ok">+ else {"{"} stats.pending++; stats.completed--; {"}"}</span>
              <span className="text-faint">  return task;</span>
            </pre>
            <div className="flex items-center gap-3 border-t border-line px-5 py-3 text-[12px]">
              <span className="rounded-full bg-bad/10 px-2 py-0.5 font-medium text-bad">before: 5/6 passing</span>
              <span className="text-faint">→ re-run in sandbox →</span>
              <span className="rounded-full bg-ok/10 px-2 py-0.5 font-medium text-ok">after: 6/6 passing</span>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="pt-16">
        <h2 className="text-[28px] font-bold tracking-tight">Everything in one workspace</h2>
        <p className="mt-1 text-[15px] text-muted">Generation and verification working together, not a chatbot in a dashboard.</p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <div key={f.t} className={`${card} p-6`}>
              <span className={`grid h-11 w-11 place-items-center rounded-full text-[15px] font-bold ${i % 2 ? "bg-[#e3ebe5] text-accent" : "bg-accent text-white"}`}>{f.t[0]}</span>
              <p className="mt-4 text-[16px] font-semibold">{f.t}</p>
              <p className="mt-1 text-[14px] leading-relaxed text-muted">{f.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="pt-16">
        <h2 className="text-[28px] font-bold tracking-tight">Idea → verified app</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {STEPS.map((s, i) => (
            <div key={s.t} className={`${card} flex gap-4 p-5`}>
              <span className="mono text-[22px] font-bold text-accent-2">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <p className="text-[15px] font-semibold">{s.t}</p>
                <p className="mt-0.5 text-[14px] text-muted">{s.d}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="pt-16">
        <h2 className="text-[28px] font-bold tracking-tight">Pricing</h2>
        <p className="mt-1 text-[15px] text-muted">Start free with your own keys. Upgrade to support DualDev.</p>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className={`${card} p-7`}>
            <p className="text-[15px] font-semibold">Free</p>
            <p className="mt-2 text-[40px] font-bold leading-none">$0</p>
            <ul className="mt-5 space-y-2 text-[14px] text-muted">
              <li>✓ AI app builder with instant preview</li>
              <li>✓ CreateOS sandbox execution (your CreateOS key)</li>
              <li>✓ Bug Hunter and website scan</li>
              <li>✓ Run locally, bring your own model key</li>
            </ul>
            <a href="/app" className="mt-6 inline-block rounded-full border border-line bg-panel px-6 py-2.5 text-[14px] font-medium hover:bg-panel-2">Open DualDev</a>
          </div>
          <div className="rounded-[24px] bg-gradient-to-br from-[#5f8069] to-[#4f6f5b] p-7 text-white shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-[15px] font-semibold">Pro</p>
              <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-[11px]">Stripe Checkout</span>
            </div>
            <p className="mt-2 text-[40px] font-bold leading-none">$19<span className="text-[16px] font-medium text-white/70">/month</span></p>
            <ul className="mt-5 space-y-2 text-[14px] text-white/85">
              <li>✓ Everything in Free</li>
              <li>✓ Early access to hosted DualDev</li>
              <li>✓ Priority support and roadmap input</li>
              <li>✓ Cancel anytime</li>
            </ul>
            <div className="mt-6"><CheckoutButton plan="pro" /></div>
          </div>
        </div>
      </section>

      <footer className="mt-16 flex flex-wrap items-center justify-between gap-3 border-t border-line-strong pt-6 text-[13px] text-faint">
        <Logo href="/" compact />
        <span>DualDev — CreateOS × Stripe Hackathon</span>
      </footer>
    </div>
  );
}
