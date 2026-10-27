import { Link } from "react-router";

export function Brand({ inverse = false }: { inverse?: boolean }) {
  return <Link to="/" className={`brand ${inverse ? "brand-inverse" : ""}`} aria-label="KampusForce home">
    <svg viewBox="0 0 34 34" aria-hidden="true"><path d="M4 4h9v10l8-10h10L20 17l11 13H20l-7-9v9H4z" /></svg>
    <span>KAMPUS<span>FORCE</span></span>
  </Link>;
}
