import type { Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StudioLab } from "../../../components/studio-lab";
import { createTargetStateAction, retryTargetStateAction, updateTreePlanAction } from "../actions";
import { getRequiredViewer } from "../../../lib/auth";
import { formatDisplayDate, getTreeDetail } from "../../../lib/bonsai";
import { getStudioData } from "../../../lib/studio";

type TreePageProps = {
  params: Promise<{
    treeId: string;
  }>;
  searchParams?: Promise<{
    tab?: string | string[];
    target?: string | string[];
  }>;
};

export const dynamic = "force-dynamic";

const TREE_DETAIL_TABS = [
  { id: "pictures", label: "Photos" },
  { id: "studio", label: "Studio" },
  { id: "care", label: "Care" },
  { id: "characteristics", label: "Tree traits" },
  { id: "bonsai", label: "Bonsai notes" },
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
  const viewer = await getRequiredViewer(`/trees/${treeId}`);
  const tree = await getTreeDetail(undefined, undefined, treeId);

  if (!tree) {
    notFound();
  }

  const activeTab = readActiveTab(resolvedSearchParams?.tab);
  const activeTabLabel = TREE_DETAIL_TABS.find((tab) => tab.id === activeTab)?.label ?? "Photos";
  const focusTargetId = readSingleValue(resolvedSearchParams?.target);
  const studio = activeTab === "studio" ? await getStudioData(viewer, treeId) : null;

  return (
    <div className="page-stack">
      <section className="section-heading">
        <p className="eyebrow">
          <Link className="crumb-link" href="/trees">Collection</Link> / Tree
        </p>
        <h1>{tree.inventoryName}</h1>
        <p className="lede">
          {formatSpeciesDisplayLabel(tree.speciesName, tree.speciesSubtitle)} in {tree.styleName}. Keep photos, notes, care guidance, and planning together for this bonsai.
        </p>
        <p className="helper-text">
          {activeTab === "pictures"
            ? "Photos are shown from oldest to newest."
            : activeTab === "studio"
              ? "Design where this tree is going — with the AI or from your own brief."
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
                  {formatPhotoSource(photo.source)}.{photo.notes ? ` ${photo.notes}` : ""}
                </p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img alt={`${tree.inventoryName} captured on ${photo.capturedAt}`} className="timeline-image" src={photo.imageUrl} />
              </article>
            ))
          )}
        </section>
      ) : activeTab === "studio" && studio ? (
        <StudioLab
          activeTargetId={studio.activeTarget?.id ?? null}
          aiConfigured={studio.aiConfigured}
          createTargetStateAction={createTargetStateAction}
          developmentPlan={tree.developmentPlan}
          focusTargetId={focusTargetId}
          renderProvider={studio.renderProvider}
          retryTargetStateAction={retryTargetStateAction}
          styleCatalog={STYLE_OPTIONS}
          targets={studio.targets}
          treeId={tree.id}
          updateTreePlanAction={updateTreePlanAction}
        />
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
                : readEntriesForTab(tree.speciesCareProfile, activeTab as Exclude<TreeDetailTabId, "pictures" | "seasonal" | "studio">).map((entry) => (
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

const STYLE_OPTIONS = [
  { id: 1, label: "Broom (Hokidachi)" },
  { id: 2, label: "Formal upright (Chokkan)" },
  { id: 3, label: "Informal upright (Moyogi)" },
  { id: 4, label: "Slanting (Shakan)" },
  { id: 5, label: "Cascade (Kengai)" },
  { id: 6, label: "Semi-cascade (Han-kengai)" },
  { id: 7, label: "Literati (Bunjingi)" },
  { id: 8, label: "Windswept (Fukinagashi)" },
  { id: 9, label: "Double trunk (Sokan)" },
  { id: 10, label: "Multi-trunk (Kabudachi)" },
  { id: 11, label: "Forest (Yose-ue)" },
  { id: 12, label: "Growing on rock (Seki-joju)" },
  { id: 13, label: "Growing in rock (Ishisuki)" },
  { id: 14, label: "Raft (Ikadabuki)" },
  { id: 15, label: "Shari deadwood (Sharimiki)" },
];

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

function readSingleValue(value: string | string[] | undefined): string | null {
  const normalized = Array.isArray(value) ? value[0] : value;
  return normalized ?? null;
}

function readActiveTab(value: string | string[] | undefined): TreeDetailTabId {
  const normalizedValue = Array.isArray(value) ? value[0] : value;

  if (normalizedValue === "plan") {
    // Old bookmarks: the Plan tab became the Studio tab.
    return "studio";
  }

  if (normalizedValue === "care" || normalizedValue === "characteristics" || normalizedValue === "bonsai" || normalizedValue === "studio" || normalizedValue === "seasonal") {
    return normalizedValue;
  }

  return "pictures";
}

function readEntriesForTab(
  treeProfile: TreeCareProfile,
  activeTab: Exclude<TreeDetailTabId, "pictures" | "seasonal" | "studio">
): TreeKnowledgeEntry[] {
  if (activeTab === "care") {
    return treeProfile.careInstructions;
  }

  if (activeTab === "characteristics") {
    return treeProfile.characteristics;
  }

  return treeProfile.bonsaiSpecifics;
}
