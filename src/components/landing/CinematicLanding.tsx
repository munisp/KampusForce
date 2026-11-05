import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowDown, ArrowRight } from "lucide-react";
import { Brand } from "@/components/product/Brand";
import "./landing.css";

const FILM = {
  wide: "/media/film/kampus-film-1280.mp4",
  tall: "/media/film/kampus-film-portrait.mp4",
  poster: "/media/film/poster.webp",
  posterTall: "/media/film/poster-portrait.webp",
};

const STATEMENT = "Campus business runs on word of mouth. An introduction is hard to prove. Commission terms are hard to read. Pay arrives when it arrives.";
const STAGES = ["Pending", "Confirmed", "Ready to pay", "Paid"];
const SIDES = [
  {
    label: "Reps",
    title: "Earn on your campus.",
    text: "Share products with your own links, QR kits and WhatsApp. There are no joining fees, and 80% of every commission is yours.",
    detail: "Campus leads earn a 5% override, paid from KampusForce's share, never from the rep's.",
    photo: "campus-group",
    alt: "A group of young people laughing together outdoors, one holding an envelope",
    position: "50% 35%",
  },
  {
    label: "Vendors",
    title: "Pay only for real sales.",
    text: "Fund commission upfront and set clear rules. You confirm each sale before anyone is paid, and every naira stays on the record.",
    detail: "Operations checks your business before you can list products or add funds.",
    photo: "market-stall",
    alt: "A trader leaning over her stall in a busy Lagos market",
    position: "70% 40%",
  },
  {
    label: "Customers",
    title: "Help you can trust.",
    text: "A rep can walk you through useful products without adding a markup, and without asking for your NIN, BVN or OTP.",
    detail: "KampusForce records your consent, never your NIN, BVN or OTP.",
    photo: "two-women-talking",
    alt: "Two women talking on a sofa",
    position: "65% 40%",
  },
];

const prefersCalm = () => {
  try {
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches || Boolean(saveData);
  } catch {
    return true;
  }
};

/** How far a tall scene has scrolled, 0 to 1, written to --p so scrolling doesn't re-render it. */
function useSceneProgress<T extends HTMLElement>(onProgress?: (progress: number) => void) {
  const ref = useRef<T>(null);
  const callback = useRef(onProgress);
  useEffect(() => { callback.current = onProgress; });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const { top, height } = element.getBoundingClientRect();
      const travel = height - window.innerHeight;
      const progress = travel > 0 ? Math.min(1, Math.max(0, -top / travel)) : 0;
      element.style.setProperty("--p", progress.toFixed(4));
      callback.current?.(progress);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);
  return ref;
}

/** Eases its content in the first time it scrolls into view. */
function Reveal({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) { setSeen(true); observer.disconnect(); }
    }, { rootMargin: "0px 0px -10% 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <div ref={ref} className={`kf-reveal ${seen ? "is-seen" : ""} ${className}`}>{children}</div>;
}

/** The film. Phones get the upright cut. Reduced motion and data saver get the still instead. */
function Film() {
  const ref = useRef<HTMLVideoElement>(null);
  const [tall] = useState(() => window.matchMedia("(max-width: 767px)").matches);
  const [calm] = useState(prefersCalm);
  useEffect(() => {
    const video = ref.current;
    if (!video || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) video.play().catch(() => undefined);
      else video.pause();
    });
    observer.observe(video);
    return () => observer.disconnect();
  }, []);
  const poster = tall ? FILM.posterTall : FILM.poster;
  if (calm) return <img className="kf-film-media" src={poster} alt="" />;
  return <video ref={ref} className="kf-film-media" src={tall ? FILM.tall : FILM.wide} poster={poster} autoPlay muted loop playsInline preload="auto" aria-hidden="true" tabIndex={-1} />;
}

function Statement() {
  const ref = useSceneProgress<HTMLElement>();
  const words = STATEMENT.split(" ");
  return <section ref={ref} className="kf-statement" style={{ "--n": words.length } as CSSProperties}>
    <div className="kf-statement-stage">
      <p className="kf-statement-text" aria-label={STATEMENT}>
        {words.map((word, index) => <span key={`${word}-${index}`} aria-hidden="true" style={{ "--w": index } as CSSProperties}>{word} </span>)}
      </p>
      <p className="kf-statement-answer">KampusForce puts all of it on one clear record.</p>
    </div>
  </section>;
}

function HowASalePays() {
  const [stage, setStage] = useState(0);
  const ref = useSceneProgress<HTMLElement>((progress) => setStage(Math.min(STAGES.length - 1, Math.floor(progress * STAGES.length))));
  return <section ref={ref} className="kf-ledger" aria-label="How a sale pays">
    <div className="kf-ledger-stage">
      <div className="kf-wrap">
        <div className="kf-ledger-head"><span className="kf-label">How a sale pays</span><span className="kf-label">An example</span></div>
        <p className="kf-ledger-amount"><small>Commission</small>₦1,000</p>
        <div className="kf-split" role="img" aria-label="₦800 to the rep, ₦200 to KampusForce"><span /><span /></div>
        <div className="kf-split-labels">
          <div><strong>₦800</strong><span>Campus rep · 80%</span></div>
          <div><strong>₦200</strong><span>KampusForce · 20%</span></div>
        </div>
        <ol className="kf-stages">{STAGES.map((name, index) => <li key={name} className={index <= stage ? "is-on" : ""} aria-current={index === stage ? "step" : undefined}>{name}</li>)}</ol>
        <p className="kf-ledger-note">Reps are paid after the vendor confirms the sale and the commission is funded.</p>
      </div>
    </div>
  </section>;
}

function Side({ side, index }: { side: (typeof SIDES)[number]; index: number }) {
  const ref = useRef<HTMLElement>(null);
  // The photo drifts a little slower than the page. Skipped entirely for reduced motion.
  useEffect(() => {
    const element = ref.current;
    if (!element || prefersCalm()) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const { top, height } = element.getBoundingClientRect();
      const offset = (top + height / 2 - window.innerHeight / 2) / window.innerHeight;
      element.style.setProperty("--parallax", `${Math.max(-1, Math.min(1, offset)) * -6}%`);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
    };
  }, []);
  return <section ref={ref} className={`kf-side ${index % 2 ? "is-flipped" : ""}`}>
    <figure className="kf-side-photo">
      <img loading="lazy" decoding="async" src={`/media/scenes/${side.photo}.webp`} srcSet={`/media/scenes/${side.photo}-800.webp 800w, /media/scenes/${side.photo}.webp 1600w`} sizes="(min-width: 900px) 60vw, 100vw" alt={side.alt} style={{ objectPosition: side.position }} />
    </figure>
    <div className="kf-side-copy">
      <Reveal>
        <p className="kf-label">{side.label}</p>
        <h2>{side.title}</h2>
        <p>{side.text}</p>
        <small>{side.detail}</small>
      </Reveal>
    </div>
  </section>;
}

type Props = {
  /** Sign-in, sign-up or continue, whichever applies to this visitor. */
  navAction: ReactNode;
  primaryAction: ReactNode;
  secondaryAction?: ReactNode;
  /** The sign-in and sign-up blocks. */
  children: ReactNode;
};

/** The KampusForce landing page, directed as a short film: opening, problem, the money, the people, the way in. */
export function CinematicLanding({ navAction, primaryAction, secondaryAction, children }: Props) {
  return <div className="kf-landing">
    <section className="kf-hero">
      <div className="kf-film"><Film /><div className="kf-film-shade" /></div>
      <header className="kf-nav kf-wrap"><Brand inverse />{navAction}</header>
      <div className="kf-hero-copy kf-wrap">
        <h1 aria-label="Every sale. Every naira. One clear record.">
          {["Every sale.", "Every naira.", "One clear record."].map((line, index) => <span key={line} className="kf-line" aria-hidden="true">
            <span style={{ "--i": index } as CSSProperties}>{line}</span>
          </span>)}
        </h1>
        <div className="kf-hero-foot">
          <p className="kf-hero-lede">KampusForce connects vendors with verified campus reps. When a vendor confirms a sale, the rep is paid.</p>
          <div className="kf-hero-actions">{primaryAction}{secondaryAction}</div>
        </div>
        <ul className="kf-hero-facts">
          <li>80% to the rep</li><li>No joining fees</li><li>Vendors fund commission upfront</li><li>Nigeria</li>
        </ul>
      </div>
      <a className="kf-scroll-cue" href="#story" aria-label="Scroll to the story"><ArrowDown size={16} /></a>
    </section>

    <div id="story"><Statement /></div>
    <HowASalePays />
    {SIDES.map((side, index) => <Side key={side.label} side={side} index={index} />)}

    <section className="kf-close" id="sandbox">
      <div className="kf-wrap">
        <Reveal><h2>Your campus.<br />Your record.</h2></Reveal>
        <div className="kf-access">{children}</div>
      </div>
    </section>

    <footer className="kf-footer">
      <div className="kf-wrap">
        <div className="kf-footer-row"><Brand inverse /><span>Vendors, campus reps and customers</span><span>Nigeria</span><a href="/signup">Create an account <ArrowRight size={14} /></a></div>
        <p className="kf-footer-mark" aria-hidden="true">KAMPUSFORCE</p>
      </div>
    </footer>
  </div>;
}
