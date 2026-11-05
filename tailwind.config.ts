import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["'IBM Plex Mono'", "ui-monospace", "monospace"],
      },
      colors: {
        ink: "#1c1917",
        paper: "#faf8f5",
        line: "#e7e2da",
        muted: "#78716c",
        accent: { DEFAULT: "#6d28d9", soft: "#ede9fe" },
        ok: "#15803d",
        warn: "#b45309",
        bad: "#b91c1c",
      },
    },
  },
  plugins: [],
};
export default config;
