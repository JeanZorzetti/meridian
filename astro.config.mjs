// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';
import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
// Default output stays `static`: marketing pages prerender. The Node adapter
// lets /admin, /login and /api/* opt into on-demand SSR via `prerender = false`.
export default defineConfig({
  integrations: [react()],
  adapter: node({ mode: 'standalone' }),

  vite: {
    plugins: [tailwindcss()]
  }
});
