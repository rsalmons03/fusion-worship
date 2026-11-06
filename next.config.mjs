import { execSync } from "node:child_process";

// Which version of the code is running, shown in the app (My profile / user menu)
// so it's easy to tell whether the latest update has been published.
function version() {
  const fromCi = process.env.WORKERS_CI_COMMIT_SHA || process.env.CF_PAGES_COMMIT_SHA || "";
  if (fromCi) return fromCi.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "dev";
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_APP_VERSION: version(),
    NEXT_PUBLIC_BUILT_AT: new Date().toISOString(),
    // If the Replicate token was added as a *Build* variable in Cloudflare, carry it into the server code
    // (only used by server routes in lib/replicate.ts; never sent to browsers).
    FW_REPLICATE_TOKEN_BUILD: process.env.REPLICATE_API_TOKEN || "",
  },
};

export default nextConfig;
