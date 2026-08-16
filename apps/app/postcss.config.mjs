// Astro loads Tailwind v4 through its Vite plugin; Next goes through PostCSS.
// Different pipe, same tokens — both end up compiling @meridian/ui/global.css.
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
