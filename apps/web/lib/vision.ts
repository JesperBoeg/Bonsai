import { getVisionServiceUrl } from "./env";

// Client for the Python vision service. The service is optional at runtime:
// when it is unconfigured, unreachable, or errors, capture continues without
// identity matching instead of failing the whole submission.

export type RecognitionCandidate = {
  treeId: string;
  photoId: string;
  inventoryName: string;
  speciesId: number | null;
  speciesName: string | null;
  styleId: number | null;
  styleName: string | null;
  embedding: number[];
  embeddingModel: string;
};

export type RawPrediction = {
  id: number | null;
  label: string;
  confidence: number;
};

export type VisionRecognitionResult = {
  visionAvailable: boolean;
  embedding: number[] | null;
  embeddingModel: string | null;
  rawCandidateMatches: Array<{ treeId: string; photoId: string; score: number }>;
  matchedTreeId: string | null;
  matchScore: number | null;
  rawSpeciesPredictions: RawPrediction[];
  rawStylePredictions: RawPrediction[];
  hostedFallbackRecommended: boolean;
  fallbackReason: string | null;
};

export type VisionLeafResult = {
  visionAvailable: boolean;
  embeddingModel: string | null;
  rawSpeciesPredictions: RawPrediction[];
  referenceCount: number;
};

export class VisionRejectionError extends Error {}

const UNAVAILABLE_RECOGNITION: VisionRecognitionResult = {
  visionAvailable: false,
  embedding: null,
  embeddingModel: null,
  rawCandidateMatches: [],
  matchedTreeId: null,
  matchScore: null,
  rawSpeciesPredictions: [],
  rawStylePredictions: [],
  hostedFallbackRecommended: false,
  fallbackReason: null,
};

type RecognitionRequestOptions = {
  includeIdentityMatches?: boolean;
  includeStylePredictions?: boolean;
};

export async function recognizeCapture(
  photo: File,
  candidates: RecognitionCandidate[],
  options: RecognitionRequestOptions = {},
): Promise<VisionRecognitionResult> {
  const serviceUrl = getVisionServiceUrl();

  if (!serviceUrl) {
    return UNAVAILABLE_RECOGNITION;
  }

  const formData = new FormData();
  formData.set("image", photo);
  formData.set(
    "candidates",
    JSON.stringify(candidates.map((candidate) => ({
      treeId: candidate.treeId,
      photoId: candidate.photoId,
      embedding: candidate.embedding,
      embeddingModel: candidate.embeddingModel,
    }))),
  );
  formData.set("include_identity_matches", String(options.includeIdentityMatches ?? false));
  formData.set("include_style_predictions", String(options.includeStylePredictions ?? false));

  let response: Response;

  try {
    response = await fetch(`${serviceUrl}/recognize`, {
      method: "POST",
      body: formData,
      cache: "no-store",
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    console.warn(`[vision] service unreachable, continuing without recognition: ${(error as Error).message}`);
    return UNAVAILABLE_RECOGNITION;
  }

  if (response.status === 422) {
    // The service actively rejected this photo (for example the background
    // check for style prediction) — that is user-actionable, so surface it.
    throw new VisionRejectionError(await readServiceErrorMessage(response, "The photo was rejected by the vision service."));
  }

  if (!response.ok) {
    console.warn(`[vision] service error ${response.status}, continuing without recognition`);
    return UNAVAILABLE_RECOGNITION;
  }

  const payload = (await response.json()) as Record<string, unknown>;

  return {
    visionAvailable: true,
    embedding: parseEmbedding(payload.embedding),
    embeddingModel: readOptionalString(payload.embedding_model),
    rawCandidateMatches: parseRawCandidates(payload.candidate_matches),
    matchedTreeId: readOptionalString(payload.matched_tree_id),
    matchScore: readOptionalNumber(payload.match_score),
    rawSpeciesPredictions: parseRawPredictions(payload.species_predictions),
    rawStylePredictions: parseRawPredictions(payload.style_predictions),
    hostedFallbackRecommended: typeof payload.hosted_fallback_recommended === "boolean" ? payload.hosted_fallback_recommended : false,
    fallbackReason: readOptionalString(payload.fallback_reason),
  };
}

export async function recognizeLeafSpecies(photo: File): Promise<VisionLeafResult> {
  const serviceUrl = getVisionServiceUrl();

  if (!serviceUrl) {
    return { visionAvailable: false, embeddingModel: null, rawSpeciesPredictions: [], referenceCount: 0 };
  }

  const formData = new FormData();
  formData.set("image", photo);

  let response: Response;

  try {
    response = await fetch(`${serviceUrl}/recognize-leaf`, {
      method: "POST",
      body: formData,
      cache: "no-store",
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    console.warn(`[vision] leaf service unreachable: ${(error as Error).message}`);
    return { visionAvailable: false, embeddingModel: null, rawSpeciesPredictions: [], referenceCount: 0 };
  }

  if (!response.ok) {
    console.warn(`[vision] leaf service error ${response.status}`);
    return { visionAvailable: false, embeddingModel: null, rawSpeciesPredictions: [], referenceCount: 0 };
  }

  const payload = (await response.json()) as Record<string, unknown>;

  return {
    visionAvailable: true,
    embeddingModel: readOptionalString(payload.embedding_model),
    rawSpeciesPredictions: parseRawPredictions(payload.species_predictions),
    referenceCount: typeof payload.reference_count === "number" && Number.isInteger(payload.reference_count) ? payload.reference_count : 0,
  };
}

async function readServiceErrorMessage(response: Response, fallbackMessage: string): Promise<string> {
  const responseText = await response.text();

  if (!responseText) {
    return fallbackMessage;
  }

  try {
    const payload = JSON.parse(responseText) as Record<string, unknown>;

    if (typeof payload.detail === "string" && payload.detail.trim().length > 0) {
      return payload.detail;
    }

    if (typeof payload.message === "string" && payload.message.trim().length > 0) {
      return payload.message;
    }
  } catch {
    return responseText;
  }

  return responseText;
}

function parseEmbedding(value: unknown): number[] | null {
  if (Array.isArray(value) && value.every((entry) => typeof entry === "number")) {
    return value;
  }

  return null;
}

function parseRawCandidates(value: unknown): Array<{ treeId: string; photoId: string; score: number }> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const record = entry as Record<string, unknown>;
      const treeId = readOptionalString(record.treeId ?? record.tree_id);
      const photoId = readOptionalString(record.photoId ?? record.photo_id);
      const score = readOptionalNumber(record.score);

      if (!treeId || !photoId || score === null) {
        return null;
      }

      return { treeId, photoId, score };
    })
    .filter((entry): entry is { treeId: string; photoId: string; score: number } => entry !== null);
}

function parseRawPredictions(value: unknown): RawPrediction[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const record = entry as Record<string, unknown>;
      const label = readOptionalString(record.label);
      const confidence = readOptionalNumber(record.confidence);

      if (!label || confidence === null) {
        return null;
      }

      const id = typeof record.id === "number" && Number.isInteger(record.id) ? record.id : null;
      return { id, label, confidence };
    })
    .filter((entry): entry is RawPrediction => entry !== null);
}

function readOptionalString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readOptionalNumber(value: unknown) {
  return typeof value === "number" ? value : null;
}
