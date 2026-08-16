import type { NextConfig } from "next";

// The app is mounted at meridian.roilabs.com.br/app, on the same host as the
// Astro site. `basePath` makes Next own that prefix end to end — its own routes,
// its own /app/_next/* assets — so the proxy rule in front can forward the path
// untouched instead of rewriting it. A rule that strips the prefix would need
// Next to be unaware of it, and the two must not disagree.
const nextConfig: NextConfig = {
  basePath: "/app",

  // The @meridian/* workspace packages export raw .ts, which Node cannot import.
  // This is the Next equivalent of `ssr.noExternal` in apps/site/astro.config.mjs:
  // without it the build passes and the server dies on the first import.
  transpilePackages: ["@meridian/core", "@meridian/db", "@meridian/ui"],
};

export default nextConfig;
