import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// `npm run build` runs the OpenNext build, which in turn runs `next build` (set here so it
// doesn't call `npm run build` again and loop).
export default {
  ...defineCloudflareConfig(),
  buildCommand: "npx next build",
};
