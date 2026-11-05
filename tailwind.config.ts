import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Lato", "system-ui", "sans-serif"],
        display: ["Montserrat", "system-ui", "sans-serif"],
        mono: ["'IBM Plex Mono'", "ui-monospace", "monospace"],
      },
      colors: {
        ink: "#111111",
        paper: "#f6f6f4",
        line: "#e4e4e0",
        muted: "#6b6b66",
        accent: { DEFAULT: "#df6437", dark: "#c0502a", soft: "#fbe8df" },
        ok: "#15803d",
        warn: "#b45309",
        bad: "#b91c1c",
      },
    },
  },
  plugins: [],
};
export default config;
