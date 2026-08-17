import { createSupabaseServerClient } from "../supabase/server";
import {
  SchemaOutdatedError,
  type CandidateMatch,
  type CollectionStore,
  type CreateTreeInput,
  type PhotoRecord,
  type Prediction,
  type StoreViewer,
  type SubmissionRecord,
  type TargetStateRecord,
  type TreeRecord,
} from "./types";

// Supabase-backed store. Authorization is enforced twice: by Postgres RLS
// policies AND by explicit owner scoping in every query, so a policy regression
// alone can never expose another user's data.

const SCHEMA_ERROR_CODES = new Set(["PGRST202", "PGRST204", "PGRST205", "42P01", "42703"]);

type SupabaseErrorShape = {
  code?: string | null;
  message: string;
};

function raiseStoreError(error: SupabaseErrorShape): never {
  if (error.code && SCHEMA_ERROR_CODES.has(error.code)) {
    throw new SchemaOutdatedError(error.message);
  }

  throw new Error(error.message);
}

function serializeEmbedding(embedding: number[] | null): string | null {
  if (!embedding || embedding.length === 0) {
    return null;
  }

  return `[${embedding.join(",")}]`;
}

function parseEmbedding(value: unknown): number[] | null {
  if (Array.isArray(value) && value.every((entry) => typeof entry === "number")) {
    return value;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;

      if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === "number")) {
        return parsed;
      }
    } catch {
      return null;
    }
  }

  return null;
}

type DbTreeRow = {
  id: string;
  owner_id: string;
  species_id: number;
  style_id: number;
  sequence_number: number;
  inventory_name: string;
  created_at: string;
  development_plan: string | null;
};

const TREE_COLUMNS = "id, owner_id, species_id, style_id, sequence_number, inventory_name, created_at, development_plan";

function mapTreeRow(row: DbTreeRow): TreeRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    speciesId: row.species_id,
    styleId: row.style_id,
    sequenceNumber: row.sequence_number,
    inventoryName: row.inventory_name,
    createdAt: row.created_at,
    developmentPlan: row.development_plan,
  };
}

type DbPhotoRow = {
  id: string;
  tree_id: string;
  capture_submission_id: string | null;
  storage_path: string;
  captured_at: string;
  source: "camera" | "upload";
  notes: string | null;
  is_reference: boolean;
  kind: string | null;
  embedding: unknown;
  embedding_model: string | null;
};

const PHOTO_COLUMNS = "id, tree_id, capture_submission_id, storage_path, captured_at, source, notes, is_reference, kind, embedding, embedding_model";

function mapPhotoRow(row: DbPhotoRow): PhotoRecord {
  return {
    id: row.id,
    treeId: row.tree_id,
    captureSubmissionId: row.capture_submission_id,
    storagePath: row.storage_path,
    capturedAt: row.captured_at,
    source: row.source,
    notes: row.notes,
    isReference: row.is_reference,
    kind: row.kind === "leaf" || row.kind === "studio-render" ? row.kind : "front",
    embedding: parseEmbedding(row.embedding),
    embeddingModel: row.embedding_model,
  };
}

type DbSubmissionRow = {
  id: string;
  owner_id: string;
  capture_intent: string | null;
  tree_resolution_mode: string | null;
  species_selection_mode: string | null;
  style_selection_mode: string | null;
  storage_path: string;
  leaf_storage_path: string | null;
  captured_at: string;
  leaf_captured_at: string | null;
  source: "camera" | "upload";
  leaf_source: "camera" | "upload" | null;
  notes: string | null;
  winter_mode: boolean | null;
  status: string;
  matched_tree_id: string | null;
  match_score: number | null;
  candidate_matches: unknown;
  species_prediction: unknown;
  species_prediction_source: string | null;
  leaf_reference_count: number | null;
  style_prediction: unknown;
  finalized_tree_id: string | null;
  finalized_photo_id: string | null;
  embedding: unknown;
  embedding_model: string | null;
  hosted_fallback_recommended: boolean | null;
  fallback_reason: string | null;
};

const SUBMISSION_COLUMNS = [
  "id", "owner_id", "capture_intent", "tree_resolution_mode", "species_selection_mode", "style_selection_mode",
  "storage_path", "leaf_storage_path", "captured_at", "leaf_captured_at", "source", "leaf_source", "notes",
  "winter_mode", "status", "matched_tree_id", "match_score", "candidate_matches", "species_prediction",
  "species_prediction_source", "leaf_reference_count", "style_prediction", "finalized_tree_id", "finalized_photo_id",
  "embedding", "embedding_model", "hosted_fallback_recommended", "fallback_reason",
].join(", ");

function mapSubmissionRow(row: DbSubmissionRow): SubmissionRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    captureIntent: row.capture_intent === "existing-tree" ? "existing-tree" : "new-tree",
    treeResolutionMode: row.tree_resolution_mode === "automatic" || row.tree_resolution_mode === "manual" ? row.tree_resolution_mode : null,
    speciesSelectionMode: row.species_selection_mode === "automatic" || row.species_selection_mode === "manual" ? row.species_selection_mode : null,
    styleSelectionMode: row.style_selection_mode === "automatic" || row.style_selection_mode === "manual" ? row.style_selection_mode : null,
    frontStoragePath: row.storage_path,
    leafStoragePath: row.leaf_storage_path,
    capturedAt: row.captured_at,
    leafCapturedAt: row.leaf_captured_at,
    source: row.source,
    leafSource: row.leaf_source,
    notes: row.notes,
    winterMode: row.winter_mode ?? false,
    status: row.status === "confirmed" ? "confirmed" : "pending",
    matchedTreeId: row.matched_tree_id,
    matchScore: row.match_score,
    candidateMatches: Array.isArray(row.candidate_matches) ? (row.candidate_matches as CandidateMatch[]) : [],
    speciesPredictions: Array.isArray(row.species_prediction) ? (row.species_prediction as Prediction[]) : [],
    speciesPredictionSource:
      row.species_prediction_source === "front-photo" || row.species_prediction_source === "leaf-reference" || row.species_prediction_source === "manual-winter"
        ? row.species_prediction_source
        : null,
    leafReferenceCount: row.leaf_reference_count,
    stylePredictions: Array.isArray(row.style_prediction) ? (row.style_prediction as Prediction[]) : [],
    finalizedTreeId: row.finalized_tree_id,
    finalizedPhotoId: row.finalized_photo_id,
    embedding: parseEmbedding(row.embedding),
    embeddingModel: row.embedding_model,
    hostedFallbackRecommended: row.hosted_fallback_recommended ?? false,
    fallbackReason: row.fallback_reason,
  };
}

type DbTargetStateRow = {
  id: string;
  tree_id: string;
  owner_id: string;
  mode: string;
  brief: string | null;
  status: string;
  plan: unknown;
  edit_instruction: string | null;
  source_photo_id: string | null;
  image_path: string | null;
  render_provider: string | null;
  model_versions: unknown;
  is_active: boolean;
  error_message: string | null;
  created_at: string;
};

const TARGET_STATE_COLUMNS = "id, tree_id, owner_id, mode, brief, status, plan, edit_instruction, source_photo_id, image_path, render_provider, model_versions, is_active, error_message, created_at";

function mapTargetStateRow(row: DbTargetStateRow): TargetStateRecord {
  return {
    id: row.id,
    treeId: row.tree_id,
    ownerId: row.owner_id,
    mode: row.mode === "directed" ? "directed" : "auto",
    brief: row.brief,
    status: row.status === "analyzing" || row.status === "rendering" || row.status === "ready" || row.status === "failed" ? row.status : "pending",
    plan: (row.plan as TargetStateRecord["plan"]) ?? null,
    editInstruction: row.edit_instruction,
    sourcePhotoId: row.source_photo_id,
    imagePath: row.image_path,
    renderProvider: row.render_provider,
    modelVersions: (row.model_versions as Record<string, string> | null) ?? null,
    isActive: row.is_active,
    errorMessage: row.error_message,
    createdAt: row.created_at,
  };
}

export class SupabaseCollectionStore implements CollectionStore {
  readonly backend = "supabase" as const;

  async listTrees(viewer: StoreViewer): Promise<TreeRecord[]> {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("trees")
      .select(TREE_COLUMNS)
      .eq("owner_id", viewer.id)
      .order("created_at", { ascending: false });

    if (error) {
      raiseStoreError(error);
    }

    return ((data ?? []) as DbTreeRow[]).map(mapTreeRow);
  }

  async getTree(viewer: StoreViewer, treeId: string): Promise<TreeRecord | null> {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("trees")
      .select(TREE_COLUMNS)
      .eq("owner_id", viewer.id)
      .eq("id", treeId)
      .maybeSingle();

    if (error) {
      raiseStoreError(error);
    }

    return data ? mapTreeRow(data as DbTreeRow) : null;
  }

  async createTree(viewer: StoreViewer, input: CreateTreeInput): Promise<TreeRecord> {
    const supabase = await createSupabaseServerClient();
    const { data: sequenceNumber, error: sequenceError } = await supabase.rpc("allocate_tree_sequence", {
      p_species_id: input.speciesId,
      p_style_id: input.styleId,
    });

    if (sequenceError) {
      raiseStoreError(sequenceError);
    }

    if (typeof sequenceNumber !== "number") {
      throw new Error("Sequence allocation did not return a number.");
    }

    const tree: TreeRecord = {
      id: crypto.randomUUID(),
      ownerId: viewer.id,
      speciesId: input.speciesId,
      styleId: input.styleId,
      sequenceNumber,
      inventoryName: input.inventoryName,
      createdAt: input.createdAt,
      developmentPlan: null,
    };

    const insertTree = (inventoryName: string) => supabase.from("trees").insert({
      id: tree.id,
      owner_id: tree.ownerId,
      species_id: tree.speciesId,
      style_id: tree.styleId,
      sequence_number: tree.sequenceNumber,
      inventory_name: inventoryName,
      created_at: tree.createdAt,
      development_plan: null,
    });

    const { error } = await insertTree(tree.inventoryName);

    if (error) {
      // Tree names are unique per owner. The default wizard name is just
      // "species - style", so a second tree of the same pair collides —
      // disambiguate with the allocated sequence number, as the naming
      // rule always intended.
      if (error.code === "23505" && error.message.includes("inventory_name")) {
        tree.inventoryName = `${tree.inventoryName} ${String(tree.sequenceNumber).padStart(2, "0")}`;
        const { error: retryError } = await insertTree(tree.inventoryName);

        if (retryError) {
          raiseStoreError(retryError);
        }
      } else {
        raiseStoreError(error);
      }
    }

    return tree;
  }

  async updateTreePlan(viewer: StoreViewer, treeId: string, developmentPlan: string | null): Promise<void> {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("trees")
      .update({ development_plan: developmentPlan })
      .eq("owner_id", viewer.id)
      .eq("id", treeId);

    if (error) {
      raiseStoreError(error);
    }
  }

  async deleteTree(viewer: StoreViewer, treeId: string): Promise<string[]> {
    const supabase = await createSupabaseServerClient();
    const { data: photoRows, error: photoError } = await supabase
      .from("photos")
      .select("storage_path, capture_submission_id, trees!inner(owner_id)")
      .eq("tree_id", treeId)
      .eq("trees.owner_id", viewer.id);

    if (photoError) {
      raiseStoreError(photoError);
    }

    const submissionIds = [
      ...new Set(
        (photoRows ?? [])
          .map((row) => (row as { capture_submission_id: string | null }).capture_submission_id)
          .filter((entry): entry is string => typeof entry === "string"),
      ),
    ];
    const storagePaths = [
      ...new Set(
        (photoRows ?? [])
          .map((row) => (row as { storage_path: string | null }).storage_path)
          .filter((entry): entry is string => typeof entry === "string"),
      ),
    ];

    const { data: targetRows } = await supabase
      .from("tree_target_states")
      .select("image_path")
      .eq("owner_id", viewer.id)
      .eq("tree_id", treeId);

    for (const row of targetRows ?? []) {
      const imagePath = (row as { image_path: string | null }).image_path;

      if (imagePath) {
        storagePaths.push(imagePath);
      }
    }

    const { data: submissionRows } = submissionIds.length > 0
      ? await supabase
          .from("capture_submissions")
          .select("leaf_storage_path")
          .eq("owner_id", viewer.id)
          .in("id", submissionIds)
      : { data: [] as Array<{ leaf_storage_path: string | null }> };

    for (const row of submissionRows ?? []) {
      const leafPath = (row as { leaf_storage_path: string | null }).leaf_storage_path;

      if (leafPath) {
        storagePaths.push(leafPath);
      }
    }

    if (submissionIds.length > 0) {
      const { error: submissionError } = await supabase
        .from("capture_submissions")
        .delete()
        .eq("owner_id", viewer.id)
        .in("id", submissionIds);

      if (submissionError && !(submissionError.code && SCHEMA_ERROR_CODES.has(submissionError.code))) {
        raiseStoreError(submissionError);
      }
    }

    const { error: treeError } = await supabase
      .from("trees")
      .delete()
      .eq("owner_id", viewer.id)
      .eq("id", treeId);

    if (treeError) {
      raiseStoreError(treeError);
    }

    return [...new Set(storagePaths)];
  }

  async listPhotos(viewer: StoreViewer): Promise<PhotoRecord[]> {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("photos")
      .select(`${PHOTO_COLUMNS}, trees!inner(owner_id)`)
      .eq("trees.owner_id", viewer.id)
      .order("captured_at", { ascending: false });

    if (error) {
      raiseStoreError(error);
    }

    return ((data ?? []) as unknown as DbPhotoRow[]).map(mapPhotoRow);
  }

  async listPhotosForTree(viewer: StoreViewer, treeId: string): Promise<PhotoRecord[]> {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("photos")
      .select(`${PHOTO_COLUMNS}, trees!inner(owner_id)`)
      .eq("trees.owner_id", viewer.id)
      .eq("tree_id", treeId)
      .order("captured_at", { ascending: true });

    if (error) {
      raiseStoreError(error);
    }

    return ((data ?? []) as unknown as DbPhotoRow[]).map(mapPhotoRow);
  }

  async getPhoto(viewer: StoreViewer, photoId: string): Promise<PhotoRecord | null> {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("photos")
      .select(`${PHOTO_COLUMNS}, trees!inner(owner_id)`)
      .eq("trees.owner_id", viewer.id)
      .eq("id", photoId)
      .maybeSingle();

    if (error) {
      raiseStoreError(error);
    }

    return data ? mapPhotoRow(data as unknown as DbPhotoRow) : null;
  }

  async createPhoto(viewer: StoreViewer, photo: PhotoRecord): Promise<void> {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("photos").insert({
      id: photo.id,
      tree_id: photo.treeId,
      capture_submission_id: photo.captureSubmissionId,
      storage_path: photo.storagePath,
      captured_at: photo.capturedAt,
      source: photo.source,
      notes: photo.notes,
      is_reference: photo.isReference,
      kind: photo.kind,
      embedding: serializeEmbedding(photo.embedding),
      embedding_model: photo.embeddingModel,
    });

    if (error) {
      raiseStoreError(error);
    }
  }

  async hasPhotosForTree(viewer: StoreViewer, treeId: string): Promise<boolean> {
    const supabase = await createSupabaseServerClient();
    const { count, error } = await supabase
      .from("photos")
      .select("id, trees!inner(owner_id)", { count: "exact", head: true })
      .eq("trees.owner_id", viewer.id)
      .eq("tree_id", treeId);

    if (error) {
      raiseStoreError(error);
    }

    return (count ?? 0) > 0;
  }

  async createSubmission(viewer: StoreViewer, submission: SubmissionRecord): Promise<void> {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("capture_submissions").insert({
      id: submission.id,
      owner_id: submission.ownerId,
      capture_intent: submission.captureIntent,
      tree_resolution_mode: submission.treeResolutionMode,
      species_selection_mode: submission.speciesSelectionMode,
      style_selection_mode: submission.styleSelectionMode,
      storage_path: submission.frontStoragePath,
      leaf_storage_path: submission.leafStoragePath,
      captured_at: submission.capturedAt,
      leaf_captured_at: submission.leafCapturedAt,
      source: submission.source,
      leaf_source: submission.leafSource,
      notes: submission.notes,
      winter_mode: submission.winterMode,
      status: submission.status,
      matched_tree_id: submission.matchedTreeId,
      match_score: submission.matchScore,
      candidate_matches: submission.candidateMatches,
      species_prediction: submission.speciesPredictions,
      species_prediction_source: submission.speciesPredictionSource,
      leaf_reference_count: submission.leafReferenceCount,
      style_prediction: submission.stylePredictions,
      embedding: serializeEmbedding(submission.embedding),
      embedding_model: submission.embeddingModel,
      hosted_fallback_recommended: submission.hostedFallbackRecommended,
      fallback_reason: submission.fallbackReason,
    });

    if (error) {
      raiseStoreError(error);
    }
  }

  async getSubmission(viewer: StoreViewer, submissionId: string): Promise<SubmissionRecord | null> {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("capture_submissions")
      .select(SUBMISSION_COLUMNS)
      .eq("owner_id", viewer.id)
      .eq("id", submissionId)
      .maybeSingle();

    if (error) {
      raiseStoreError(error);
    }

    return data ? mapSubmissionRow(data as unknown as DbSubmissionRow) : null;
  }

  async markSubmissionConfirmed(
    viewer: StoreViewer,
    submissionId: string,
    finalized: { treeId: string; photoId: string },
  ): Promise<void> {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("capture_submissions")
      .update({
        status: "confirmed",
        finalized_tree_id: finalized.treeId,
        finalized_photo_id: finalized.photoId,
      })
      .eq("owner_id", viewer.id)
      .eq("id", submissionId);

    if (error) {
      raiseStoreError(error);
    }
  }

  async createTargetState(viewer: StoreViewer, record: TargetStateRecord): Promise<void> {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("tree_target_states").insert({
      id: record.id,
      tree_id: record.treeId,
      owner_id: record.ownerId,
      mode: record.mode,
      brief: record.brief,
      status: record.status,
      plan: record.plan,
      edit_instruction: record.editInstruction,
      source_photo_id: record.sourcePhotoId,
      image_path: record.imagePath,
      render_provider: record.renderProvider,
      model_versions: record.modelVersions,
      is_active: record.isActive,
      error_message: record.errorMessage,
      created_at: record.createdAt,
    });

    if (error) {
      raiseStoreError(error);
    }
  }

  async getTargetState(viewer: StoreViewer, targetId: string): Promise<TargetStateRecord | null> {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("tree_target_states")
      .select(TARGET_STATE_COLUMNS)
      .eq("owner_id", viewer.id)
      .eq("id", targetId)
      .maybeSingle();

    if (error) {
      raiseStoreError(error);
    }

    return data ? mapTargetStateRow(data as DbTargetStateRow) : null;
  }

  async listTargetStatesForTree(viewer: StoreViewer, treeId: string): Promise<TargetStateRecord[]> {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("tree_target_states")
      .select(TARGET_STATE_COLUMNS)
      .eq("owner_id", viewer.id)
      .eq("tree_id", treeId)
      .order("created_at", { ascending: false });

    if (error) {
      raiseStoreError(error);
    }

    return ((data ?? []) as DbTargetStateRow[]).map(mapTargetStateRow);
  }

  async updateTargetState(
    viewer: StoreViewer,
    targetId: string,
    patch: Partial<Omit<TargetStateRecord, "id" | "treeId" | "ownerId" | "createdAt">>,
  ): Promise<void> {
    const supabase = await createSupabaseServerClient();
    const payload: Record<string, unknown> = {};

    if (patch.mode !== undefined) payload.mode = patch.mode;
    if (patch.brief !== undefined) payload.brief = patch.brief;
    if (patch.status !== undefined) payload.status = patch.status;
    if (patch.plan !== undefined) payload.plan = patch.plan;
    if (patch.editInstruction !== undefined) payload.edit_instruction = patch.editInstruction;
    if (patch.sourcePhotoId !== undefined) payload.source_photo_id = patch.sourcePhotoId;
    if (patch.imagePath !== undefined) payload.image_path = patch.imagePath;
    if (patch.renderProvider !== undefined) payload.render_provider = patch.renderProvider;
    if (patch.modelVersions !== undefined) payload.model_versions = patch.modelVersions;
    if (patch.isActive !== undefined) payload.is_active = patch.isActive;
    if (patch.errorMessage !== undefined) payload.error_message = patch.errorMessage;

    const { error } = await supabase
      .from("tree_target_states")
      .update(payload)
      .eq("owner_id", viewer.id)
      .eq("id", targetId);

    if (error) {
      raiseStoreError(error);
    }
  }

  async setActiveTargetState(viewer: StoreViewer, treeId: string, targetId: string): Promise<void> {
    const supabase = await createSupabaseServerClient();
    const { error: clearError } = await supabase
      .from("tree_target_states")
      .update({ is_active: false })
      .eq("owner_id", viewer.id)
      .eq("tree_id", treeId);

    if (clearError) {
      raiseStoreError(clearError);
    }

    const { error } = await supabase
      .from("tree_target_states")
      .update({ is_active: true })
      .eq("owner_id", viewer.id)
      .eq("id", targetId);

    if (error) {
      raiseStoreError(error);
    }
  }
}
