import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* --------------------------------------------------------------------
   * The /api/update/* routes read the package root at RUNTIME
   * (BOALI_ROOT / process.cwd()). Next's output file tracer sees the
   * process.cwd() literal and conservatively copies the whole project
   * tree (mini-services weights, python runtime, …) into the standalone
   * webapp/ folder — +2.2 GB and a >2 GB release zip GitHub rejects.
   * None of those files belong inside webapp/ (the real ones live at
   * the package root), so exclude them from tracing for every route.
   * ------------------------------------------------------------------ */
  outputFileTracingExcludes: {
    "*": [
      "./mini-services/**/*",
      "./runtime/**/*",
      "./weights/**/*",
      "./public/samples/**/*",
      "./tools/**/*",
      "./windows/**/*",
      "./logs/**/*",
      "./.update/**/*",
      "./upload/**/*",
      "./download/**/*",
      "./skills/**/*",
      "./tool-results/**/*",
      "./examples/**/*",
      "./dev.log",
      "./bun.lock",
      "./tsconfig.tsbuildinfo",
    ],
  },
  /* allow the sandbox preview domain + local gateway origin to load dev
   * assets and keep the HMR socket alive (blocked HMR causes reload loops) */
  allowedDevOrigins: [
    "preview-chat-a9a15e1a-cf8a-48ae-9d30-876e1f61b757.space-z.ai",
    "127.0.0.1",
    "localhost",
  ],
  experimental: {
    /* the host has 3.9 GB RAM shared with the python engine services —
     * keep turbopack well below the OOM threshold */
    turbopackMemoryLimit: 1.5 * 1024 * 1024 * 1024,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  /* --------------------------------------------------------------------
   * CRITICAL: the dev script pipes output through `tee dev.log`, and the
   * engine/pacs services write *.log files inside the project. webpack's
   * watcher picks those log writes up as "source changes" → Fast Refresh
   * full-reloads the page every time a request is logged → an infinite
   * reload loop that resets all React state (users get bounced back to
   * the launcher screen seconds after entering any module). Ignoring
   * *.log + tool artifacts from the watcher breaks the loop.
   * ------------------------------------------------------------------ */
  webpack: (config) => {
    const existing = config.watchOptions?.ignored;
    const list = Array.isArray(existing)
      ? existing
      : typeof existing === "string"
        ? [existing]
        : [];
    config.watchOptions = {
      ...config.watchOptions,
      ignored: [...list, "**/*.log", "**/tool-results/**", "**/db/**"],
    };
    return config;
  },
};

export default nextConfig;
