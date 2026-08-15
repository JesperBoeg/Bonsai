import type { Metadata, Viewport } from "next";
import { Alegreya_Sans, Cormorant_Garamond } from "next/font/google";
import Link from "next/link";
import type { ReactNode } from "react";
import { signOutAction } from "./auth/actions";
import SwRegister from "../components/sw-register";
import { getOptionalViewer } from "../lib/auth";
import { isLocalBackend } from "../lib/backend";
import "./globals.css";

const bodyFont = Alegreya_Sans({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500", "700"],
});

const displayFont = Cormorant_Garamond({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Bonsai",
  description: "Track individual bonsai trees through photos and recognition.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", type: "image/png", sizes: "192x192" },
    ],
    apple: [{ url: "/icons/icon-192.png", sizes: "192x192" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#5f7a53",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const viewer = await getOptionalViewer();
  const localMode = isLocalBackend();

  return (
    <html lang="en">
      <body className={`${bodyFont.variable} ${displayFont.variable}`}>
        <SwRegister />
        <div className="shell">
          <header className="site-header">
            <div className="brand-cluster">
              <Link className="wordmark" href="/">
                Bonsai
              </Link>
            </div>
            <div className="nav-cluster">
              <nav className="main-nav" aria-label="Primary navigation">
                <Link href="/capture">Capture</Link>
                <Link href="/trees">Collection</Link>
                {viewer?.isAdmin && !localMode ? <Link href="/leaf-review">Leaf review</Link> : null}
              </nav>
              {localMode ? (
                <span className="nav-badge">Local mode</span>
              ) : viewer ? (
                <form action={signOutAction}>
                  <button className="nav-button" type="submit">
                    Sign out
                  </button>
                </form>
              ) : null}
            </div>
          </header>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
