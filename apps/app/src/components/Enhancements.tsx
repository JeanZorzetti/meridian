"use client";

import { useEffect } from "react";
import { start } from "@/lib/interactions";

/**
 * The two browser-side layers the Astro Layout used to provide.
 *
 * This is not decoration you can skip. `global.css` hides every `.reveal` while
 * the `.js` class is on <html>, and sizes the category bars with
 * `.js .reveal.is-visible .bar { width: var(--w) }`. Without the observer below,
 * four panels of the budget screen stay at `opacity: 0` forever, and every bar
 * renders full width — the same numbers, drawn wrong.
 *
 * The `.js` class itself is set by an inline script in the layout, not here:
 * it has to land before first paint, and an effect runs after one.
 */
export default function Enhancements() {
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.12 },
    );
    const observe = () =>
      document.querySelectorAll(".reveal:not(.is-visible)").forEach((el) => io.observe(el));
    observe();

    // React mounts .reveal nodes after this effect's first run (Trends and Goals
    // fetch, then render). observe() is idempotent — it filters :not(.is-visible)
    // and io.observe on an already-watched node is a no-op — so a re-scan per
    // mutation batch is enough. ponytail: rescans the whole doc per batch
    // (~200 nodes, sub-ms); switch to entry.addedNodes if it shows up in a profile.
    const mo = new MutationObserver(observe);
    mo.observe(document.body, { childList: true, subtree: true });

    const stopInteractions = start();

    return () => {
      mo.disconnect();
      io.disconnect();
      stopInteractions();
    };
  }, []);

  return null;
}
