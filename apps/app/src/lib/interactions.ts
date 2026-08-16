/**
 * Cinematic interaction layer. Components opt in with data-attributes and the
 * matching CSS classes (see the "interaction layer" block in global.css):
 *
 *   data-tilt="6"      → element rotates toward the cursor (max 6°) and exposes
 *                        --rx/--ry/--mx/--my for a .tilt transform + .glare sheen
 *   data-spotlight     → element only tracks the pointer (--mx/--my), no tilt
 *   data-parallax="0.12" → element drifts on scroll via --py (× scroll offset)
 *
 * Ported from apps/site/src/scripts/interactions.ts. Two differences: the Astro
 * copy is a module that runs itself on import and re-wires on `astro:after-swap`
 * (an event that does not exist here), so this one exports a `start()` the layout
 * calls once and returns a teardown, which is what React effects want.
 *
 * The budget panel uses one [data-tilt="2"] card with a .glare — small, but
 * dropping it would be a visible difference from the /admin screen it replaces.
 */
export function start(): () => void {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fine = matchMedia("(pointer: fine)").matches;

  const teardown: (() => void)[] = [];

  function resetTilt(el: HTMLElement | SVGElement) {
    el.style.setProperty("--rx", "0deg");
    el.style.setProperty("--ry", "0deg");
  }

  // The interactive elements under the cursor right now — kept so we can reset
  // the tilt on the ones the pointer just left.
  let active: (HTMLElement | SVGElement)[] = [];
  let raf = 0;

  function onPointerMove(e: PointerEvent) {
    // The whole ancestor chain, not closest(): a [data-tilt] card can sit inside
    // a [data-spotlight] section, and both need the pointer.
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

  function onPointerLeave() {
    for (const el of active) resetTilt(el);
    active = [];
  }

  if (fine && !reduce) {
    document.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("pointerleave", onPointerLeave);
    teardown.push(() => {
      cancelAnimationFrame(raf);
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerleave", onPointerLeave);
    });
  }

  if (!reduce) {
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-parallax]"));
    if (els.length) {
      let praf = 0;
      const update = () => {
        praf = 0;
        const mid = innerHeight / 2;
        for (const el of els) {
          const speed = Number(el.dataset.parallax) || 0.1;
          const r = el.getBoundingClientRect();
          el.style.setProperty("--py", `${-(r.top + r.height / 2 - mid) * speed}px`);
        }
      };
      const onScroll = () => {
        if (!praf) praf = requestAnimationFrame(update);
      };
      addEventListener("scroll", onScroll, { passive: true });
      addEventListener("resize", onScroll);
      update();
      teardown.push(() => {
        cancelAnimationFrame(praf);
        removeEventListener("scroll", onScroll);
        removeEventListener("resize", onScroll);
      });
    }
  }

  return () => {
    for (const fn of teardown) fn();
  };
}
