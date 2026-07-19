// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  // Tell nitro to output in Vercel's native format (.vercel/output).
  // This only runs during `vite build` — dev server is unaffected.
  // Override by setting NITRO_PRESET env var if you ever need a different target.
  nitro: {
    preset: (process.env.NITRO_PRESET as string | undefined) ?? "vercel",
  },
  vite: {
    server: {
      host: "0.0.0.0",     // bind to IPv4 (no IPv6 in this environment)
      allowedHosts: true,  // allow Replit preview proxy domains
    },
    // Bundle @vercel/analytics into the SSR output instead of treating it as
    // an external — prevents a duplicate-React error ("Invalid hook call") that
    // appears when the package is loaded as a separate module in the SSR context.
    ssr: {
      noExternal: ["@vercel/analytics"],
    },
    resolve: {
      dedupe: ["react", "react-dom"],
    },
  },
});
