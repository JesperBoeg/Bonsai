export type PhotoKind = "front" | "leaf" | "studio-render";
export type CaptureIntent = "existing-tree" | "new-tree";
export type CaptureSource = "camera" | "upload";
export type TreeResolutionMode = "automatic" | "manual";
export type SelectionMode = "automatic" | "manual";
export type SubmissionStatus = "pending" | "confirmed";
export type SpeciesPredictionSource = "front-photo" | "leaf-reference" | "manual-winter";

export type StoreViewer = {
  id: string;
};

export type TreeRecord = {
  id: string;
  ownerId: string;
  speciesId: number;
  styleId: number;
  sequenceNumber: number;
  inventoryName: string;
  createdAt: string;
  developmentPlan: string | null;
};

export type PhotoRecord = {
  id: string;
  treeId: string;
  captureSubmissionId: string | null;
  storagePath: string;
  capturedAt: string;
  source: CaptureSource;
  notes: string | null;
  isReference: boolean;
  kind: PhotoKind;
  embedding: number[] | null;
  embeddingModel: string | null;
};

export type Prediction = {
  id: number | null;
  label: string;
  subtitle?: string | null;
  confidence: number;
};

export type CandidateMatch = {
  treeId: string;
  photoId: string;
  inventoryName: string;
  speciesId: number | null;
  speciesName: string | null;
  styleId: number | null;
  styleName: string | null;
  score: number;
};

export type SubmissionRecord = {
  id: string;
  ownerId: string;
  captureIntent: CaptureIntent;
  treeResolutionMode: TreeResolutionMode | null;
  speciesSelectionMode: SelectionMode | null;
  styleSelectionMode: SelectionMode | null;
  frontStoragePath: string;
  leafStoragePath: string | null;
  capturedAt: string;
  leafCapturedAt: string | null;
  source: CaptureSource;
  leafSource: CaptureSource | null;
  notes: string | null;
  winterMode: boolean;
  status: SubmissionStatus;
  matchedTreeId: string | null;
  matchScore: number | null;
  candidateMatches: CandidateMatch[];
  speciesPredictions: Prediction[];
  speciesPredictionSource: SpeciesPredictionSource | null;
  leafReferenceCount: number | null;
  stylePredictions: Prediction[];
  finalizedTreeId: string | null;
  finalizedPhotoId: string | null;
  embedding: number[] | null;
  embeddingModel: string | null;
  hostedFallbackRecommended: boolean;
  fallbackReason: string | null;
};

export type TargetStateMode = "auto" | "directed";
export type TargetStateStatus = "pending" | "analyzing" | "rendering" | "ready" | "failed";

export type TargetStagedMove = {
  stage: string;
  timing: string;
  actions: string[];
};

export type TargetStatePlan = {
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
  stagedPlan: TargetStagedMove[];
  cautions: string[];
};

export type TargetStateRecord = {
  id: string;
  treeId: string;
  ownerId: string;
  mode: TargetStateMode;
  brief: string | null;
  status: TargetStateStatus;
  plan: TargetStatePlan | null;
  editInstruction: string | null;
  sourcePhotoId: string | null;
  imagePath: string | null;
  renderProvider: string | null;
  modelVersions: Record<string, string> | null;
  isActive: boolean;
  errorMessage: string | null;
  createdAt: string;
};

export type CreateTreeInput = {
  speciesId: number;
  styleId: number;
  inventoryName: string;
  createdAt: string;
};

// Thrown by the Supabase backend when the database is missing migrations the
// code depends on. Surfaced to the user as an actionable message instead of a 500.
export class SchemaOutdatedError extends Error {
  constructor(detail: string) {
    super(
      `The database schema is missing recent migrations (${detail}). ` +
      "Apply them with: npx supabase db push (see docs/DEPLOY.md).",
    );
    this.name = "SchemaOutdatedError";
  }
}

export interface CollectionStore {
  readonly backend: "local" | "supabase";
  listTrees(viewer: StoreViewer): Promise<TreeRecord[]>;
  getTree(viewer: StoreViewer, treeId: string): Promise<TreeRecord | null>;
  createTree(viewer: StoreViewer, input: CreateTreeInput): Promise<TreeRecord>;
  updateTreePlan(viewer: StoreViewer, treeId: string, developmentPlan: string | null): Promise<void>;
  /** Deletes the tree (and via it, photos/submissions/target states). Returns storage paths to unlink. */
  deleteTree(viewer: StoreViewer, treeId: string): Promise<string[]>;
  listPhotos(viewer: StoreViewer): Promise<PhotoRecord[]>;
  listPhotosForTree(viewer: StoreViewer, treeId: string): Promise<PhotoRecord[]>;
  getPhoto(viewer: StoreViewer, photoId: string): Promise<PhotoRecord | null>;
  createPhoto(viewer: StoreViewer, photo: PhotoRecord): Promise<void>;
  hasPhotosForTree(viewer: StoreViewer, treeId: string): Promise<boolean>;
  createSubmission(viewer: StoreViewer, submission: SubmissionRecord): Promise<void>;
  getSubmission(viewer: StoreViewer, submissionId: string): Promise<SubmissionRecord | null>;
  markSubmissionConfirmed(
    viewer: StoreViewer,
    submissionId: string,
    finalized: { treeId: string; photoId: string },
  ): Promise<void>;
  createTargetState(viewer: StoreViewer, record: TargetStateRecord): Promise<void>;
  getTargetState(viewer: StoreViewer, targetId: string): Promise<TargetStateRecord | null>;
  listTargetStatesForTree(viewer: StoreViewer, treeId: string): Promise<TargetStateRecord[]>;
  updateTargetState(
    viewer: StoreViewer,
    targetId: string,
    patch: Partial<Omit<TargetStateRecord, "id" | "treeId" | "ownerId" | "createdAt">>,
  ): Promise<void>;
  setActiveTargetState(viewer: StoreViewer, treeId: string, targetId: string): Promise<void>;
}
