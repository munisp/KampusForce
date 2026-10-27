export function Loading({ label = "Reading the ledger…" }: { label?: string }) {
  return <div className="loading-state" role="status"><span className="loading-line" /><span className="loading-line short" /><p>{label}</p></div>;
}

export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return <div className="error-state" role="alert"><strong>We couldn’t load this workspace.</strong><p>{message}</p>{retry && <button className="button secondary" onClick={retry}>Try again</button>}</div>;
}
