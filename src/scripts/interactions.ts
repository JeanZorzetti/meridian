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
 */

const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const fine = matchMedia("(pointer: fine)").matches;

function initTilt() {
  document.querySelectorAll<HTMLElement>("[data-tilt]").forEach((el) => {
    const max = Number(el.dataset.tilt) || 6;
    let raf = 0;
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width; // 0..1
      const py = (e.clientY - r.top) / r.height;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        el.style.setProperty("--rx", `${(0.5 - py) * max * 2}deg`);
        el.style.setProperty("--ry", `${(px - 0.5) * max * 2}deg`);
        el.style.setProperty("--mx", `${px * 100}%`);
        el.style.setProperty("--my", `${py * 100}%`);
      });
    });
    el.addEventListener("pointerleave", () => {
      cancelAnimationFrame(raf);
      el.style.setProperty("--rx", "0deg");
      el.style.setProperty("--ry", "0deg");
    });
  });
}

function initSpotlight() {
  document.querySelectorAll<HTMLElement>("[data-spotlight]").forEach((el) => {
    let raf = 0;
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        el.style.setProperty("--mx", `${((e.clientX - r.left) / r.width) * 100}%`);
        el.style.setProperty("--my", `${((e.clientY - r.top) / r.height) * 100}%`);
      });
    });
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

function init() {
  if (fine && !reduce) {
    initTilt();
    initSpotlight();
  }
  if (!reduce) initParallax();
}

if (document.readyState !== "loading") init();
else document.addEventListener("DOMContentLoaded", init);

// re-wire after Astro view transitions (same guard as the reveal observer)
document.addEventListener("astro:after-swap", init);
