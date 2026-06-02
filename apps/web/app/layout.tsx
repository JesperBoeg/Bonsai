import type { Metadata } from "next";
import { Alegreya_Sans, Cormorant_Garamond } from "next/font/google";
import Link from "next/link";
import type { ReactNode } from "react";
import { signOutAction } from "./auth/actions";
import { getOptionalViewer } from "../lib/auth";
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
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const viewer = await getOptionalViewer();

  return (
    <html lang="en">
      <body className={`${bodyFont.variable} ${displayFont.variable}`}>
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
                {viewer?.isAdmin ? <Link href="/leaf-review">Leaf review</Link> : null}
              </nav>
              {viewer ? (
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
