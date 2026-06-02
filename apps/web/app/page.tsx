import Link from "next/link";
import { getTreeSummaries } from "../lib/bonsai";
import { getRequiredViewer } from "../lib/auth";

const pillars = [
  {
    title: "Capture in the moment",
    body: "Take a photo in the garden or choose one from your device when you are ready to file it.",
  },
  {
    title: "Keep each tree distinct",
    body: "Review the closest match so each photo lands on the right bonsai.",
  },
  {
    title: "Follow the tree over time",
    body: "Build a visual history with photos, notes, and future care reminders.",
  },
];

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const viewer = await getRequiredViewer("/");
  const treeCount = (await getTreeSummaries()).length;

  return (
    <div className="page-stack">
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">Your bonsai, season by season.</p>
          <h1>Keep a living record of every bonsai.</h1>
          <p className="lede">
            Every photo should stay attached to the right tree so you can see shape, refinement, and care change over time.
          </p>
          <p className="status-strip">
            Signed in as {viewer.email}. {treeCount} tree{treeCount === 1 ? "" : "s"} in your collection.
          </p>
          <div className="action-row">
            <Link className="button button-solid" href="/capture">
              Open capture
            </Link>
            <Link className="button button-ghost" href="/trees">
              Open collection
            </Link>
          </div>
        </div>
        <div className="hero-aside">
          <div className="formula-card">
            <span>Naming guide</span>
            <strong>Species / Style / Number</strong>
            <p>Example: Juniperus procumbens / Informal upright (Moyogi) / 03</p>
          </div>
          <div className="formula-card muted">
            <span>How review works</span>
            <strong>Suggest first, confirm second</strong>
            <p>The app shows its best guess, and you make the final call.</p>
          </div>
        </div>
      </section>

      <section className="feature-card">
        <h2>How it works</h2>
        <p>
          A new photo is reviewed before it is attached to a tree, so the collection stays clean and easy to trust.
        </p>
      </section>

      <section className="grid-panel" aria-label="Core features">
        {pillars.map((pillar) => (
          <article className="feature-card" key={pillar.title}>
            <h2>{pillar.title}</h2>
            <p>{pillar.body}</p>
          </article>
        ))}
      </section>
    </div>
  );
}
