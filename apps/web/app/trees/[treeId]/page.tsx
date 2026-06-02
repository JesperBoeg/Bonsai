import type { Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SubmitButton } from "../../../components/submit-button";
import { updateTreePlanAction } from "../actions";
import { formatDisplayDate, getTreeDetail } from "../../../lib/bonsai";

type TreePageProps = {
  params: Promise<{
    treeId: string;
  }>;
  searchParams?: Promise<{
    tab?: string | string[];
  }>;
};

export const dynamic = "force-dynamic";

const TREE_DETAIL_TABS = [
  { id: "pictures", label: "Photos" },
  { id: "care", label: "Care" },
  { id: "characteristics", label: "Tree traits" },
  { id: "bonsai", label: "Bonsai notes" },
  { id: "plan", label: "Plan" },
  { id: "seasonal", label: "Seasonal guide" },
] as const;

type TreeDetailTabId = (typeof TREE_DETAIL_TABS)[number]["id"];
type TreeKnowledgeEntry = {
  title: string;
  detail: string;
};

type TreeCareProfile = {
  careInstructions: TreeKnowledgeEntry[];
  characteristics: TreeKnowledgeEntry[];
  bonsaiSpecifics: TreeKnowledgeEntry[];
};

export default async function TreePage({ params, searchParams }: TreePageProps) {
  const { treeId } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const tree = await getTreeDetail(undefined, undefined, treeId);

  if (!tree) {
    notFound();
  }

  const activeTab = readActiveTab(resolvedSearchParams?.tab);
  const activeTabLabel = TREE_DETAIL_TABS.find((tab) => tab.id === activeTab)?.label ?? "Photos";

  return (
    <div className="page-stack">
      <section className="section-heading">
        <p className="eyebrow">Tree</p>
        <h1>{tree.inventoryName}</h1>
        <p className="lede">
          {formatSpeciesDisplayLabel(tree.speciesName, tree.speciesSubtitle)} in {tree.styleName}. Keep photos, notes, care guidance, and planning together for this bonsai.
        </p>
        <p className="helper-text">
          {activeTab === "pictures"
            ? "Photos are shown from oldest to newest."
            : activeTab === "plan"
              ? "Keep track of current work and future direction for this tree."
              : `${activeTabLabel} for ${formatSpeciesDisplayLabel(tree.speciesName, tree.speciesSubtitle)}.`}
        </p>
      </section>

      <nav aria-label="Tree detail sections" className="tree-tab-row">
        {TREE_DETAIL_TABS.map((tab) => {
          const href = (tab.id === "pictures" ? `/trees/${treeId}` : `/trees/${treeId}?tab=${tab.id}`) as Route;

          return (
            <Link
              aria-current={activeTab === tab.id ? "page" : undefined}
              className={`tree-tab${activeTab === tab.id ? " is-active" : ""}`}
              href={href}
              key={tab.id}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      {activeTab === "pictures" ? (
        <section className="timeline-shell">
          {tree.photos.length === 0 ? (
            <article className="timeline-card">
              <span className="timeline-date">No photos yet</span>
              <strong>This tree is waiting for its first photo.</strong>
              <p>Use capture to add the first photo for this bonsai.</p>
            </article>
          ) : (
            tree.photos.map((photo) => (
              <article className="timeline-card" key={photo.id}>
                <span className="timeline-date">{formatDisplayDate(photo.capturedAt)}</span>
                <strong>{photo.isReference ? "Reference photo" : "Photo"}</strong>
                <p>
                  {formatPhotoSource(photo.source)}. {photo.notes ? photo.notes : "No notes for this photo."}
                </p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img alt={`${tree.inventoryName} captured on ${photo.capturedAt}`} className="timeline-image" src={photo.imageUrl} />
              </article>
            ))
          )}
        </section>
      ) : activeTab === "plan" ? (
        <section className="knowledge-shell">
          <article className="knowledge-card">
            <span className="formula-card-label">Plan</span>
            <h2>Development plan</h2>
            <p>Use this space for the current work, next steps, and longer-term ideas for this bonsai.</p>
            <form action={updateTreePlanAction} className="inline-form">
              <input name="treeId" type="hidden" value={tree.id} />
              <label className="field-block">
                <span>Plan notes</span>
                <textarea
                  defaultValue={tree.developmentPlan ?? ""}
                  name="developmentPlan"
                  placeholder="Note pruning goals, wiring ideas, repot timing, branch decisions, and future direction."
                  rows={10}
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
      ) : (
        <section className="knowledge-shell">
          {!tree.speciesCareProfile ? (
            <article className="timeline-card knowledge-empty-card">
              <span className="timeline-date">Guide unavailable</span>
              <strong>There is no care guide for this species yet.</strong>
              <p>You can still keep photos for this tree while the species notes are being added.</p>
            </article>
          ) : (
            <>
              {activeTab === "seasonal"
                ? tree.speciesCareProfile.seasonCalendar.map((entry) => (
                    <article className="knowledge-card" key={`${activeTab}-${entry.window}-${entry.title}`}>
                      <span className="formula-card-label">{entry.window}</span>
                      <h2>{entry.title}</h2>
                      <p>{entry.detail}</p>
                    </article>
                  ))
                : readEntriesForTab(tree.speciesCareProfile, activeTab).map((entry) => (
                    <article className="knowledge-card" key={`${activeTab}-${entry.title}`}>
                      <span className="formula-card-label">{activeTabLabel}</span>
                      <h2>{entry.title}</h2>
                      <p>{entry.detail}</p>
                    </article>
                  ))}
            </>
          )}
        </section>
      )}
    </div>
  );
}

function formatSpeciesDisplayLabel(label: string, subtitle: string | null) {
  return subtitle ? `${label} (${subtitle})` : label;
}

function formatPhotoSource(source: string) {
  if (source === "camera") {
    return "Taken with the camera";
  }

  if (source === "upload") {
    return "Added from the gallery";
  }

  return "Photo added";
}

function readActiveTab(value: string | string[] | undefined): TreeDetailTabId {
  const normalizedValue = Array.isArray(value) ? value[0] : value;

  if (normalizedValue === "care" || normalizedValue === "characteristics" || normalizedValue === "bonsai" || normalizedValue === "plan" || normalizedValue === "seasonal") {
    return normalizedValue;
  }

  return "pictures";
}

function readEntriesForTab(
  treeProfile: TreeCareProfile,
  activeTab: Exclude<TreeDetailTabId, "pictures" | "seasonal" | "plan">
): TreeKnowledgeEntry[] {
  if (activeTab === "care") {
    return treeProfile.careInstructions;
  }

  if (activeTab === "characteristics") {
    return treeProfile.characteristics;
  }

  return treeProfile.bonsaiSpecifics;
}
