"use client";

import Link from "next/link";

type ErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  const isSchemaOutdated = error.message.includes("supabase db push") || error.message.includes("missing recent migrations");

  return (
    <div className="page-stack">
      <section className="feature-card error-card" role="alert">
        <p className="eyebrow error-eyebrow">Something went wrong</p>
        <h1>{isSchemaOutdated ? "The database needs an update" : "That did not work"}</h1>
        <p>
          {isSchemaOutdated
            ? "The app is newer than its database. Apply the pending migrations with `npx supabase db push`, then reload."
            : error.message || "An unexpected error interrupted the page."}
        </p>
        <div className="capture-step-actions">
          <button className="button button-solid" onClick={reset} type="button">
            Try again
          </button>
          <Link className="button button-ghost" href="/">
            Back to home
          </Link>
        </div>
      </section>
    </div>
  );
}
