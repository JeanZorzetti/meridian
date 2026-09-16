// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';
import node from '@astrojs/node';
import vercel from '@astrojs/vercel';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
// Default output stays `static`: marketing pages prerender. The adapter lets
// /admin, /login and /api/* opt into on-demand SSR via `prerender = false`.
// Vercel sets VERCEL=1 at build time; the EasyPanel service keeps the Node
// adapter until DNS moves, since it still redeploys on every push to main.
// ponytail: drop the node branch once the EasyPanel service is gone.
export default defineConfig({
  site: 'https://meridian.roilabs.com.br',
  integrations: [react()],
  adapter: process.env.VERCEL ? vercel() : node({ mode: 'standalone' }),

  security: {
    // The proxy terminates TLS and forwards plain HTTP, so the request reaches
    // Node as http:// while the browser sends Origin: https://. Astro only
    // trusts x-forwarded-proto/host when this list is non-empty, and otherwise
    // falls back to localhost — which makes the CSRF check reject every POST.
    // Baked in at build time: adding a domain needs a rebuild, not just an env var.
    allowedDomains: [
      { protocol: 'https', hostname: 'sirius-crm-meridian.7c17iw.easypanel.host' },
      // Kept alongside the vendor host during the domain migration: the vendor
      // host keeps serving until DNS cuts over, and dropping it early breaks
      // every POST on the live site.
      { protocol: 'https', hostname: 'meridian.roilabs.com.br' },
    ],
  },

  vite: {
    plugins: [tailwindcss()],
    ssr: {
      // The @meridian/* workspace packages export raw .ts. Vite externalizes
      // anything it finds under node_modules for the SSR build, and Node cannot
      // import TypeScript — so without this the server bundle builds fine and
      // then dies at runtime on the first `import "@meridian/db"`. Listed
      // explicitly rather than relying on Vite's linked-package heuristic,
      // because that heuristic is not a contract.
      noExternal: ['@meridian/core', '@meridian/db', '@meridian/ui'],
    },
  }
});
