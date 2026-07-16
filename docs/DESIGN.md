# Meridian — "Dark Swiss" Design System

The single source of truth is [`src/styles/global.css`](../src/styles/global.css); the
live reference renders at [`/styleguide`](http://localhost:4321/styleguide). This file
mirrors those tokens as plain text so the visual can be round-tripped into Figma
(Stitch → Figma → Dev Mode → code) in a later session.

> Stitch project: "Meridian — Dark Swiss finance landing" (design system
> "Dark Swiss Precision"). Regenerate/edit screens there, then export to Figma.

## Principles
Near-black canvas · hairline structure · one mint accent reserved for status.
Swiss typographic rigor + subtle glassmorphism. Confidence and speed of an
advanced trading tool, cleanliness of a modern SaaS. Restraint is the point:
boldness is spent once, on the self-drawing net-worth curve.

## Color
| Token | Hex | Use |
|-------|-----|-----|
| background | `#08080A` | Canvas — near-black |
| surface-1 | `#0E0E10` | Card / panel |
| surface-2 | `#131315` | Popover |
| surface-3 | `#1C1B1E` | Track / inset |
| foreground | `#ECECEE` | Primary text |
| muted-foreground | `#8E8E96` | Secondary text (≥4.5:1 on bg) |
| primary / profit | `#3ECF8E` | Mint — brand · positive · CTA |
| destructive / loss | `#F0616D` | Negative only |
| hairline / border | `rgba(255,255,255,0.08)` | 1px structure |

Accent (mint/rose) appears **only** on financial status. Everything else is
monochrome. `primary-foreground` on mint buttons is `#06120C`.

## Typography
- **Geist Sans** — display, headings, body. Tight negative tracking on large sizes.
- **Geist Mono** — every number, ticker, eyebrow, and data label (`tabular-nums`).

| Role | Size / tracking / weight |
|------|--------------------------|
| Display | 72 / −4.5% / 600 |
| Headline | 36 / −3% / 600 |
| Title | 20 / −2% / 500 |
| Body | 16 / 1.6 lh / 400 |
| Data | Geist Mono, tabular |
| Eyebrow | Geist Mono 11 / 0.14em / caps |

## Geometry & motion
- Radius: `--radius: 0.375rem` → buttons ~5px, cards ~8px. No pills except status chips.
- Spacing: 4px base grid, 24px gutter, 48px page margin, 1200px container.
- Elevation: tonal layers + `.glass` (3% white, 16px blur, hairline). Shadows only for the highest elevation.
- Motion: one easing `cubic-bezier(0.22, 1, 0.36, 1)`. Reveals rise 18px / 600ms. `prefers-reduced-motion` disables all.

## Components (best-of-each, one base)
- **shadcn/ui** (Radix, Nova preset) — the single primitive base, retinted to Dark Swiss.
- **Magic UI** — `Marquee` (integrations strip).
- **Anime.js** — the signature net-worth curve (`NetWorthChart.tsx`, draws on load).
- **CSS + IntersectionObserver** — scroll reveals (progressive enhancement; visible without JS).
- HeroUI / Aceternity / framer-motion — evaluated, deliberately not used (restraint > spectacle for this brief).
