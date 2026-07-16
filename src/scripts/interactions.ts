/**
 * Cinematic interaction layer. Components opt in with data-attributes and the
 * matching CSS classes (see the "interaction layer" block in global.css):
 *
 *   data-tilt="6"      → element rotates toward the cursor (max 6°) and exposes
 *                        --rx/--ry/--mx/--my for a .tilt transform + .glare sheen
 *   data-spotlight     → element only tracks the pointer (--mx/--my), no tilt
 *   data-parallax="0.12" → element drifts on scroll via --py (× scroll offset)
 *
 * Everything is CSS-var driven, so with no JS or under reduced motion the page
 * renders in a calm static state. Tilt/spotlight need a fine pointer; parallax
 * runs everywhere. rAF-batched to stay off the layout hot path.
 *
 * Tilt/spotlight run through ONE delegated pointermove on the document rather
 * than a listener per element: the /admin panel is React and mounts its cards
 * after this script runs (Trends, Goals), so per-element wiring at load would
 * miss them — and re-running it on astro:after-swap would double-bind the
 * survivors. Delegation covers future nodes for free.
 */

const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const fine = matchMedia("(pointer: fine)").matches;

function resetTilt(el: HTMLElement | SVGElement) {
  el.style.setProperty("--rx", "0deg");
  el.style.setProperty("--ry", "0deg");
}

// The interactive elements under the cursor right now — kept so we can reset the
// tilt on the ones the pointer just left.
let active: (HTMLElement | SVGElement)[] = [];
let raf = 0;

function onPointerMove(e: PointerEvent) {
  // The whole ancestor chain, not closest(): Hero.astro nests a [data-tilt] card
  // inside a [data-spotlight] section, and both need the pointer — exactly what
  // the old per-element listeners gave, since the event bubbled up to both.
  const chain: (HTMLElement | SVGElement)[] = [];
  for (let node = e.target as Element | null; node; node = node.parentElement) {
    const ds = (node as HTMLElement).dataset;
    if (ds && (ds.tilt !== undefined || ds.spotlight !== undefined)) chain.push(node as HTMLElement);
  }
  const left = active;
  active = chain;
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    for (const el of left) if (!chain.includes(el)) resetTilt(el);
    for (const el of chain) {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width; // 0..1
      const py = (e.clientY - r.top) / r.height;
      el.style.setProperty("--mx", `${px * 100}%`);
      el.style.setProperty("--my", `${py * 100}%`);
      const max = Number((el as HTMLElement).dataset.tilt); // data-spotlight → NaN → no tilt
      if (max) {
        el.style.setProperty("--rx", `${(0.5 - py) * max * 2}deg`);
        el.style.setProperty("--ry", `${(px - 0.5) * max * 2}deg`);
      }
    }
  });
}

function initParallax() {
  const els = Array.from(document.querySelectorAll<HTMLElement>("[data-parallax]"));
  if (!els.length) return;
  let raf = 0;
  const update = () => {
    raf = 0;
    const mid = innerHeight / 2;
    for (const el of els) {
      const speed = Number(el.dataset.parallax) || 0.1;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--py", `${-(r.top + r.height / 2 - mid) * speed}px`);
    }
  };
  const onScroll = () => {
    if (!raf) raf = requestAnimationFrame(update);
  };
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onScroll);
  update();
}

// The delegated pointer handlers bind to the document once, for the page's whole
// life — no per-swap rebinding, so no accumulation. Only parallax rescans.
if (fine && !reduce) {
  document.addEventListener("pointermove", onPointerMove, { passive: true });
  document.addEventListener("pointerleave", () => {
    for (const el of active) resetTilt(el);
    active = [];
  });
}

function init() {
  if (!reduce) initParallax();
}

if (document.readyState !== "loading") init();
else document.addEventListener("DOMContentLoaded", init);

// re-wire parallax after Astro view transitions (same guard as the reveal observer)
document.addEventListener("astro:after-swap", init);
