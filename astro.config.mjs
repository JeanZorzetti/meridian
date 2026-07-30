// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';
import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
// Default output stays `static`: marketing pages prerender. The Node adapter
// lets /admin, /login and /api/* opt into on-demand SSR via `prerender = false`.
export default defineConfig({
  site: 'https://meridian.roilabs.com.br',
  integrations: [react()],
  adapter: node({ mode: 'standalone' }),

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
    plugins: [tailwindcss()]
  }
});
