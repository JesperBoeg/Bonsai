export default function Loading() {
  return (
    <div className="page-stack">
      <section className="section-heading" aria-busy="true" aria-live="polite">
        <p className="eyebrow">Loading</p>
        <h1 className="loading-shimmer">Fetching your trees...</h1>
        <p className="lede">One moment.</p>
      </section>
    </div>
  );
}
