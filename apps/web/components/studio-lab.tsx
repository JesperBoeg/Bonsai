"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SubmitButton } from "./submit-button";

type StudioTarget = {
  id: string;
  mode: "auto" | "directed";
  brief: string | null;
  status: "pending" | "analyzing" | "rendering" | "ready" | "failed";
  plan: {
    assessment: {
      trunk: string;
      nebari: string;
      branches: string;
      foliage: string;
      healthFlags: string[];
    };
    target: {
      styleSlug: string | null;
      styleLabel: string;
      horizonYears: number;
      silhouette: string;
      keyMoves: string[];
      rationale: string;
    };
    stagedPlan: Array<{ stage: string; timing: string; actions: string[] }>;
    cautions: string[];
  } | null;
  editInstruction: string | null;
  imageUrl: string | null;
  sourcePhotoUrl: string | null;
  renderProvider: string | null;
  errorMessage: string | null;
  isActive: boolean;
  createdAt: string;
};

type StudioLabProps = {
  treeId: string;
  targets: StudioTarget[];
  activeTargetId: string | null;
  focusTargetId: string | null;
  aiConfigured: boolean;
  renderProvider: string;
  styleCatalog: Array<{ id: number; label: string }>;
  developmentPlan: string | null;
  createTargetStateAction: (formData: FormData) => void | Promise<void>;
  updateTreePlanAction: (formData: FormData) => void | Promise<void>;
};

const IN_PROGRESS_STATUSES = new Set(["pending", "analyzing", "rendering"]);

const STATUS_COPY: Record<string, string> = {
  pending: "Queued — getting ready to study your tree...",
  analyzing: "Studying your tree — trunk line, branches, foliage, health...",
  rendering: "Painting the target — rendering a photo of the future tree...",
};

export function StudioLab({
  treeId,
  targets,
  activeTargetId,
  focusTargetId,
  aiConfigured,
  renderProvider,
  styleCatalog,
  developmentPlan,
  createTargetStateAction,
  updateTreePlanAction,
}: StudioLabProps) {
  const router = useRouter();
  const [mode, setMode] = useState<"auto" | "directed">("auto");
  const [split, setSplit] = useState(50);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(focusTargetId ?? activeTargetId);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const inProgressTarget = useMemo(
    () => targets.find((target) => IN_PROGRESS_STATUSES.has(target.status)) ?? null,
    [targets],
  );
  const shownTarget = useMemo(() => {
    const readyTargets = targets.filter((target) => target.status === "ready");
    return (
      readyTargets.find((target) => target.id === selectedTargetId)
      ?? readyTargets.find((target) => target.id === activeTargetId)
      ?? readyTargets[0]
      ?? null
    );
  }, [targets, selectedTargetId, activeTargetId]);
  const failedTarget = useMemo(
    () => (targets[0]?.status === "failed" ? targets[0] : null),
    [targets],
  );

  useEffect(() => {
    if (!inProgressTarget) {
      return;
    }

    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/studio/${inProgressTarget.id}`, { cache: "no-store" });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as { status: string };

        if (!IN_PROGRESS_STATUSES.has(payload.status)) {
          clearInterval(timer);
          router.refresh();
        }
      } catch {
        // Transient polling failure — keep trying.
      }
    }, 2500);
    pollTimerRef.current = timer;

    return () => {
      clearInterval(timer);
    };
  }, [inProgressTarget, router]);

  return (
    <div className="studio-stack">
      {inProgressTarget ? (
        <section className="capture-card accent-card studio-progress" aria-live="polite">
          <span className="capture-step-pill">Designing</span>
          <h2>{STATUS_COPY[inProgressTarget.status] ?? "Working..."}</h2>
          <p className="helper-text">
            This usually takes under a minute. You can leave this page — the design keeps going and will be
            waiting here.
          </p>
          <div className="studio-progress-track" role="presentation">
            <div className={`studio-progress-fill studio-progress-${inProgressTarget.status}`} />
          </div>
        </section>
      ) : null}

      {failedTarget ? (
        <section className="capture-card studio-failed" role="alert">
          <span className="timeline-date">Design failed</span>
          <strong>The last design attempt did not finish.</strong>
          <p className="helper-text">{failedTarget.errorMessage ?? "Something went wrong. Try again."}</p>
        </section>
      ) : null}

      {shownTarget && shownTarget.plan ? (
        <section className="capture-card studio-target-card">
          <div className="studio-target-heading">
            <div>
              <span className="eyebrow">Target state</span>
              <h2>
                {shownTarget.plan.target.styleLabel} · about {shownTarget.plan.target.horizonYears} year
                {shownTarget.plan.target.horizonYears === 1 ? "" : "s"}
              </h2>
              <p className="support-text">
                Designed {formatStudioDate(shownTarget.createdAt)}
                {shownTarget.mode === "directed" ? " from your brief" : " by the AI from the current photos"}.
              </p>
            </div>
          </div>

          {shownTarget.imageUrl && shownTarget.sourcePhotoUrl ? (
            <figure className="studio-compare-figure">
              <div className="studio-compare" style={{ ["--split" as string]: `${split}%` }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img alt="The tree today" className="studio-compare-image" src={shownTarget.sourcePhotoUrl} />
                <div className="studio-compare-overlay">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img alt="AI render of the target state" className="studio-compare-image" src={shownTarget.imageUrl} />
                </div>
                <span className="studio-compare-label studio-compare-label-left">Target</span>
                <span className="studio-compare-label studio-compare-label-right">Today</span>
                <div className="studio-compare-handle" aria-hidden="true" />
              </div>
              <input
                aria-label="Compare today with the target state"
                className="studio-compare-range"
                max={100}
                min={0}
                onChange={(event) => {
                  setSplit(Number(event.target.value));
                }}
                type="range"
                value={split}
              />
              <figcaption className="helper-text">
                Drag to compare the tree today with the rendered target.
                {shownTarget.renderProvider === "mock"
                  ? " This render is a placeholder (mock provider) — add GEMINI_API_KEY for photoreal renders."
                  : null}
              </figcaption>
            </figure>
          ) : (
            <div className="studio-render-missing">
              <p className="helper-text">
                {shownTarget.errorMessage
                  ?? "No photoreal render for this design — the target is described below. Configure GEMINI_API_KEY to render it."}
              </p>
            </div>
          )}

          <div className="studio-plan-grid">
            <article className="knowledge-card">
              <span className="formula-card-label">The tree today</span>
              <h3>Assessment</h3>
              <p><strong>Trunk.</strong> {shownTarget.plan.assessment.trunk}</p>
              <p><strong>Nebari.</strong> {shownTarget.plan.assessment.nebari}</p>
              <p><strong>Branches.</strong> {shownTarget.plan.assessment.branches}</p>
              <p><strong>Foliage.</strong> {shownTarget.plan.assessment.foliage}</p>
              {shownTarget.plan.assessment.healthFlags.length > 0 ? (
                <p><strong>Watch.</strong> {shownTarget.plan.assessment.healthFlags.join(" ")}</p>
              ) : null}
            </article>

            <article className="knowledge-card">
              <span className="formula-card-label">Where it is going</span>
              <h3>{shownTarget.plan.target.silhouette}</h3>
              <p>{shownTarget.plan.target.rationale}</p>
              <ul className="studio-move-list">
                {shownTarget.plan.target.keyMoves.map((move) => (
                  <li key={move}>{move}</li>
                ))}
              </ul>
            </article>
          </div>

          <article className="knowledge-card studio-stages">
            <span className="formula-card-label">Staged plan</span>
            <h3>Season by season</h3>
            <ol className="studio-stage-list">
              {shownTarget.plan.stagedPlan.map((stage) => (
                <li key={stage.stage}>
                  <strong>{stage.stage}</strong>
                  <span className="studio-stage-timing">{stage.timing}</span>
                  <ul>
                    {stage.actions.map((action) => (
                      <li key={action}>{action}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
            {shownTarget.plan.cautions.length > 0 ? (
              <div className="status-strip">
                <strong>Take care</strong>
                <p>{shownTarget.plan.cautions.join(" ")}</p>
              </div>
            ) : null}
          </article>
        </section>
      ) : null}

      {!inProgressTarget ? (
        <section className="capture-card studio-generate">
          <span className="eyebrow">Design a target</span>
          <h2>{shownTarget ? "Design a new target" : "What should this tree become?"}</h2>
          {!aiConfigured ? (
            <p className="helper-text">
              The Design Studio needs an Anthropic API key. Set <code>ANTHROPIC_API_KEY</code> in the server
              environment and restart the app.
            </p>
          ) : (
            <form action={createTargetStateAction} className="inline-form">
              <input name="treeId" type="hidden" value={treeId} />
              <input name="mode" type="hidden" value={mode} />
              <div className="capture-choice-grid">
                <button
                  className={`capture-choice-card${mode === "auto" ? " is-selected" : ""}`}
                  onClick={() => {
                    setMode("auto");
                  }}
                  type="button"
                >
                  <strong>Let the AI style it</strong>
                  <span>The AI studies the photos and proposes the best achievable target for this tree.</span>
                </button>
                <button
                  className={`capture-choice-card${mode === "directed" ? " is-selected" : ""}`}
                  onClick={() => {
                    setMode("directed");
                  }}
                  type="button"
                >
                  <strong>Brief the designer</strong>
                  <span>Tell the AI where you want to take the tree; it designs within your brief.</span>
                </button>
              </div>

              {mode === "directed" ? (
                <div className="studio-brief-fields">
                  <label className="field-block">
                    <span>Your brief</span>
                    <textarea
                      name="brief"
                      placeholder="Example: develop this into a windswept tree leaning left, reduce the height, keep the current pot."
                      rows={3}
                    />
                  </label>
                  <div className="studio-brief-row">
                    <label className="field-block">
                      <span>Target style (optional)</span>
                      <select defaultValue="" name="targetStyleId">
                        <option value="">Let the AI choose</option>
                        {styleCatalog.map((style) => (
                          <option key={style.id} value={style.id}>
                            {style.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field-block">
                      <span>Time horizon</span>
                      <select defaultValue="" name="horizonYears">
                        <option value="">Let the AI choose</option>
                        <option value="2">About 2 years</option>
                        <option value="5">About 5 years</option>
                        <option value="10">About 10 years</option>
                      </select>
                    </label>
                  </div>
                </div>
              ) : null}

              <div className="capture-step-actions">
                <SubmitButton className="button button-solid" pendingLabel="Starting the design...">
                  {shownTarget ? "Design a new target" : "Design the target"}
                </SubmitButton>
              </div>
              <p className="helper-text">
                Takes about a minute. The AI writes a structural assessment, a staged development plan, and
                {renderProvider === "none" ? " — once an image key is configured — " : " "}
                renders a photo of this tree as it could look.
              </p>
            </form>
          )}
        </section>
      ) : null}

      {targets.filter((target) => target.status === "ready").length > 1 ? (
        <section className="capture-card">
          <span className="eyebrow">Earlier targets</span>
          <div className="studio-history-row">
            {targets
              .filter((target) => target.status === "ready")
              .map((target) => (
                <button
                  className={`studio-history-chip${shownTarget?.id === target.id ? " is-selected" : ""}`}
                  key={target.id}
                  onClick={() => {
                    setSelectedTargetId(target.id);
                  }}
                  type="button"
                >
                  {target.plan?.target.styleLabel ?? "Target"} · {formatStudioDate(target.createdAt)}
                </button>
              ))}
          </div>
        </section>
      ) : null}

      <section className="knowledge-shell">
        <article className="knowledge-card">
          <span className="formula-card-label">Your notes</span>
          <h2>Development plan</h2>
          <p>Your own working notes for this tree — kept alongside the AI target.</p>
          <form action={updateTreePlanAction} className="inline-form">
            <input name="treeId" type="hidden" value={treeId} />
            <label className="field-block">
              <span>Plan notes</span>
              <textarea
                defaultValue={developmentPlan ?? ""}
                name="developmentPlan"
                placeholder="Note pruning goals, wiring ideas, repot timing, branch decisions, and future direction."
                rows={8}
              />
            </label>
            <div className="capture-step-actions">
              <SubmitButton className="button button-solid" pendingLabel="Saving the plan...">
                Save plan
              </SubmitButton>
            </div>
          </form>
        </article>
      </section>
    </div>
  );
}

function formatStudioDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}
