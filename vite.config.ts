// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // Daily Supabase keep-alive cron handler (see src/server-keepalive.ts).
  // The lovable config's published types don't list `plugins`, but it is a
  // standard nitro option that is passed straight through to Nitro's vite
  // plugin — hence the cast.
  nitro: {
    plugins: ["./src/server-keepalive.ts"],
    // Cloudflare Workers: always-on, no sleep (Render free sleeps after 15 min).
    // Lovable sandbox forces cloudflare-module + dist/server output; local/GitHub
    // builds use the explicit preset + dirs below so scripts/deploy-cloudflare.mjs
    // can find the bundle regardless of where it was built.
    preset: "cloudflare-module",
    output: {
      dir: ".output",
      serverDir: ".output/server",
      publicDir: ".output/public",
    },
    routeRules: {
      "/**": {
        headers: {
          "X-Frame-Options": "DENY",
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "strict-origin-when-cross-origin",
          "Cross-Origin-Opener-Policy": "same-origin",
          "Cross-Origin-Resource-Policy": "same-site",
          "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          "Content-Security-Policy":
            "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https: blob:; media-src 'self' blob:; frame-src 'self' blob:; connect-src 'self' https://*.supabase.co https://sheets.googleapis.com https://oauth2.googleapis.com https://www.googleapis.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
        },
      },
    },
  } as { preset?: string; output?: unknown; routeRules?: unknown },
});
