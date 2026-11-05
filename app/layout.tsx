import type { Metadata, Viewport } from "next";
import "./globals.css";
import { CHURCH_NAME } from "@/lib/format";
import UpdateBanner from "@/components/UpdateBanner";

export const metadata: Metadata = {
  title: { default: CHURCH_NAME, template: `%s · ${CHURCH_NAME}` },
  description: "Plan services, manage songs, and schedule teams.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#ffffff" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Lato:wght@400;700;900&family=Montserrat:wght@600;700;800;900&family=IBM+Plex+Mono:wght@500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {children}
        <UpdateBanner />
      </body>
    </html>
  );
}
