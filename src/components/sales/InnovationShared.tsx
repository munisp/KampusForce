import { type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { EmptyState } from "@/components/product/WorkspaceLayout";

export type InnovationFeature = { key: string; label: string; description: string };

export function FeatureNavigation({ features, active, onChange, label }: { features: InnovationFeature[]; active: string; onChange: (key: string) => void; label: string }) {
  return <nav className="innovation-feature-nav" aria-label={label}>
    {features.map((feature) => <button key={feature.key} className={active === feature.key ? "active" : ""} aria-current={active === feature.key ? "page" : undefined} onClick={() => onChange(feature.key)}>
      <span><strong>{feature.label}</strong><small>{feature.description}</small></span><ChevronRight size={15} aria-hidden="true" />
    </button>)}
  </nav>;
}

export function InnovationLayout({ features, active, onChange, label, children }: { features: InnovationFeature[]; active: string; onChange: (key: string) => void; label: string; children: ReactNode }) {
  const current = features.find((feature) => feature.key === active) || features[0];
  return <div className="innovation-shell">
    <FeatureNavigation features={features} active={current.key} onChange={onChange} label={label} />
    <section className="innovation-inspector" aria-labelledby={`innovation-${current.key}`}>
      <header className="innovation-inspector-head"><div><span>Controlled workflow</span><h2 id={`innovation-${current.key}`}>{current.label}</h2></div><p>{current.description}</p></header>
      {children}
    </section>
  </div>;
}

export function ActionError({ error }: { error?: { message: string } | null }) {
  return error ? <p className="form-error" role="alert">{error.message}</p> : null;
}

export function ActionSuccess({ children }: { children: ReactNode }) {
  return <p className="innovation-success" role="status">{children}</p>;
}

export function NoRecords({ title = "No records yet", detail }: { title?: string; detail: string }) {
  return <EmptyState title={title} detail={detail} />;
}

export function RecordGrid({ children }: { children: ReactNode }) {
  return <div className="innovation-record-grid">{children}</div>;
}

export function RecordItem({ title, meta, status, children, actions }: { title: string; meta?: string; status?: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return <article className="innovation-record">
    <header><div><strong>{title}</strong>{meta && <small>{meta}</small>}</div>{status}</header>
    {children && <div className="innovation-record-body">{children}</div>}
    {actions && <footer>{actions}</footer>}
  </article>;
}

export function HashValue({ value }: { value?: string | null }) {
  if (!value) return <>—</>;
  return <span className="hash-value" title={value}>{value.slice(0, 10)}…{value.slice(-6)}</span>;
}

export function FormActions({ children }: { children: ReactNode }) {
  return <div className="innovation-form-actions">{children}</div>;
}
