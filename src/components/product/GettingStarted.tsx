import { ArrowRight, Check, Clock3 } from "lucide-react";
import { Link, useLocation } from "react-router";

type Step = { key: string; title: string; detail: string; state: "done" | "current" | "waiting" | "todo"; href?: string; action?: string };

/** Ordered setup steps for a new vendor or campus rep, with one clear next action. Hidden once everything is done. */
export function GettingStarted({ steps, intro }: { steps: Step[]; intro: string }) {
  const location = useLocation();
  if (!steps.length || steps.every((s) => s.state === "done")) return null;
  const done = steps.filter((s) => s.state === "done").length;
  const next = steps.find((s) => s.state === "current") || steps.find((s) => s.state === "waiting");
  // Links to a section on the page you're already on scroll there and put the cursor in it.
  const jump = (href: string) => {
    const [path, id] = href.split("#");
    if (!id || path !== location.pathname) return;
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) el.focus({ preventScroll: true });
  };
  return <section className="getting-started" id="getting-started" aria-labelledby="getting-started-title">
    <div className="getting-started-head">
      <div><p className="eyebrow">Getting started · {done} of {steps.length} done</p><h2 id="getting-started-title">{next?.state === "waiting" && !steps.some((s) => s.state === "current") ? "You're waiting on Operations" : next ? next.title : "Almost there"}</h2><p>{intro}</p></div>
      <div className="getting-started-meter" aria-hidden="true"><span style={{ width: `${(done / steps.length) * 100}%` }} /></div>
    </div>
    <ol className="getting-started-steps">
      {steps.map((step) => <li key={step.key} className={`gs-step gs-${step.state}`} aria-current={step.state === "current" ? "step" : undefined}>
        <span className="gs-mark" aria-hidden="true">{step.state === "done" ? <Check size={14} /> : step.state === "waiting" ? <Clock3 size={14} /> : null}</span>
        <div className="gs-body">
          <strong>{step.title}<span className="visually-hidden"> ({step.state === "done" ? "done" : step.state === "waiting" ? "waiting for Operations" : step.state === "current" ? "do this next" : "later"})</span></strong>
          <p>{step.detail}</p>
        </div>
        {step.href && step.action && step.state !== "done" && step.state !== "todo" && <Link className={step.state === "current" ? "button primary small" : "button secondary small"} to={step.href} onClick={() => jump(step.href!)}>{step.action}{step.state === "current" && <ArrowRight size={14} />}</Link>}
      </li>)}
    </ol>
  </section>;
}
