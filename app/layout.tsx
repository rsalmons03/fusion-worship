import type { Metadata, Viewport } from "next";
import "./globals.css";
import { CHURCH_NAME } from "@/lib/format";

export const metadata: Metadata = {
  title: { default: CHURCH_NAME, template: `%s · ${CHURCH_NAME}` },
  description: "Plan services, manage songs, and schedule teams.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#6d28d9" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
