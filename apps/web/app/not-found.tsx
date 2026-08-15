import Link from "next/link";

export default function NotFound() {
  return (
    <div className="page-stack">
      <section className="feature-card">
        <p className="eyebrow">Not found</p>
        <h1>This page does not exist.</h1>
        <p>The tree or page you were looking for may have been removed.</p>
        <div className="capture-step-actions">
          <Link className="button button-solid" href="/trees">
            Go to the collection
          </Link>
          <Link className="button button-ghost" href="/">
            Back to home
          </Link>
        </div>
      </section>
    </div>
  );
}
