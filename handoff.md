> ⚠️ **Desatualizado (julho/2026).** O documento atual é
> [`docs/HANDOFF.md`](docs/HANDOFF.md). Este aqui descreve `/admin` como stub,
> quando o app completo já existe, e o projeto ainda como pasta única, quando já
> é um monorepo. Mantido só como registro do que era.

# Meridian — handoff

**What this is:** a beauty-first marketing site for a personal-finance product,
built as a front-end portfolio piece (closes the "Figma→production / UI polish"
gap for the FitNext Frontend Engineer application). Aesthetic: **Dark Swiss**.

**Location:** `C:\dev\meridian` (outside OneDrive — avoids the node_modules
corruption issue). Dark-only, static-first.

## Stack
- **Astro 7** + **React 19 islands** (`@astrojs/react`) — static-first, islands for interactivity.
- **Tailwind v4** + **shadcn/ui** (Radix, Nova preset → Geist + Lucide), retinted to Dark Swiss in `src/styles/global.css`.
- **Geist Sans + Geist Mono** (Fontsource). **Anime.js v4** (signature chart). **Magic UI** Marquee. `motion` installed (unused — reveals are CSS/IO).

## Run
```bash
cd C:\dev\meridian
npm run dev       # http://localhost:4321
npm run build     # static output → dist/
npm run preview   # serve the build
```

## Routes
- `/` — landing: Hero → Metrics → Integrations → Features (bento) → Product tour → Security → Pricing → CTA → Footer.
- `/pricing` — tiers + FAQ (native `<details>`).
- `/styleguide` — **living design system** (tokens, type scale, themed shadcn primitives, signature chart). Portfolio differentiator.
- `/admin` — stub. The functional full-stack app is a **future session** (out of scope here).

## Key decisions
- **Astro, not Nuxt:** the chosen libs (shadcn/Magic UI/etc.) are React; Astro runs them as islands, Nuxt can't.
- **shadcn is the single primitive base.** Magic UI/Anime.js added surgically. HeroUI/Aceternity deliberately unused (restraint).
- **Signature:** self-drawing net-worth curve — `src/components/react/NetWorthChart.tsx` (Anime.js `svg.createDrawable`).
- **Reveals are CSS + IntersectionObserver** (`.reveal` + `Reveal.astro` + observer in `Layout.astro`), not framer-motion — visible without JS, no SSR-hidden content, lighter.
- Design tokens + rationale: [`docs/DESIGN.md`](docs/DESIGN.md).

## Verified
- Production build passes (4 pages, 0 errors). Preview renders identically, 0 console errors.
- Mobile (390px): no horizontal overflow, hamburger menu works, hero card + chart fit, sections stack.
- **Contrast: 0 WCAG AA failures** (canvas-composited audit; all dim `/70`,`/60` text raised to solid `muted-foreground` ≈6:1).
- Focus-visible outline, `prefers-reduced-motion`, aria on chart/nav/menu, labeled input.

## Open / next
1. **Figma round-trip (your async action):** authorize the Figma MCP in an interactive session (`/mcp`), export the Stitch "Dark Swiss Precision" design to Figma, then build any refinements from Dev Mode. Harness step this session couldn't reach (non-interactive OAuth).
2. **`/admin` functional app** — separate session (accounts, live data, auth). shadcn primitives here are reusable in it.
3. **Deploy:** Vercel recommended (static). If VPS/nginx: `absolute_redirect off` + trailing slash.
4. Product name `Meridian` is a placeholder — rename freely (wordmark in `Nav.astro`/`Footer.astro`, titles in `Layout.astro`).
5. Marquee duplicates institution names to screen readers (minor) — add `aria-hidden` to clones if it matters.
