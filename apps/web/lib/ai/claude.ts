import Anthropic from "@anthropic-ai/sdk";
import type { CatalogEntry } from "../catalog";
import { getAnthropicApiKey } from "../env";
import type { TargetStateMode, TargetStatePlan } from "../store/types";

// Claude powers two things: species/style suggestions from capture photos, and
// the Design Studio's target-state analysis. Server-side fallbacks are enabled
// by default so a safety-classifier decline re-runs on Anthropic's recommended
// fallback model instead of failing the request.

const CLAUDE_MODEL = "claude-opus-5";

let cachedClient: Anthropic | null = null;

export function isClaudeConfigured() {
  return getAnthropicApiKey() !== null;
}

function getClient(): Anthropic {
  if (!cachedClient) {
    cachedClient = new Anthropic({ apiKey: getAnthropicApiKey() ?? undefined });
  }

  return cachedClient;
}

type ImageInput = {
  base64: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
};

function imageBlock(image: ImageInput) {
  return {
    type: "image" as const,
    source: {
      type: "base64" as const,
      media_type: image.mimeType,
      data: image.base64,
    },
  };
}

async function createStructuredMessage(options: {
  system: string;
  content: Anthropic.ContentBlockParam[];
  schema: Record<string, unknown>;
  maxTokens: number;
}): Promise<unknown> {
  const client = getClient();
  const request = {
    model: CLAUDE_MODEL,
    max_tokens: options.maxTokens,
    system: options.system,
    output_config: { format: { type: "json_schema" as const, schema: options.schema } },
    messages: [{ role: "user" as const, content: options.content }],
  };

  let response: Anthropic.Message;

  try {
    response = await client.beta.messages.create({
      ...request,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    } as never) as Anthropic.Message;
  } catch (error) {
    if (error instanceof Anthropic.BadRequestError) {
      // Fallbacks beta unavailable for this key/platform — run without it.
      try {
        response = await client.messages.create(request);
      } catch (retryError) {
        throw toFriendlyAiError(retryError);
      }
    } else {
      throw toFriendlyAiError(error);
    }
  }

  if (response.stop_reason === "refusal") {
    throw new Error("The AI declined to analyze this image.");
  }

  const textBlock = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === "text",
  );

  if (!textBlock) {
    throw new Error("The AI response contained no result.");
  }

  return JSON.parse(textBlock.text) as unknown;
}

// --- Species and style suggestions -----------------------------------------

export type ClaudeSuggestionResult = {
  species: Array<{ slug: string | null; label: string; confidence: number }>;
  styles: Array<{ slug: string; label: string; confidence: number }>;
};

const SUGGESTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["species", "styles"],
  properties: {
    species: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["slug", "label", "confidence"],
        properties: {
          slug: { type: ["string", "null"], description: "Catalog slug, or null if not in the catalog" },
          label: { type: "string" },
          confidence: { type: "number" },
        },
      },
    },
    styles: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["slug", "label", "confidence"],
        properties: {
          slug: { type: "string" },
          label: { type: "string" },
          confidence: { type: "number" },
        },
      },
    },
  },
} as const;

export async function suggestSpeciesAndStyle(options: {
  frontImage: ImageInput;
  leafImage: ImageInput | null;
  speciesCatalog: CatalogEntry[];
  styleCatalog: CatalogEntry[];
  wantSpecies: boolean;
  wantStyles: boolean;
}): Promise<ClaudeSuggestionResult> {
  const speciesList = options.speciesCatalog
    .map((entry) => `${entry.slug} | ${entry.label}${entry.subtitle ? ` | ${entry.subtitle}` : ""}`)
    .join("\n");
  const styleList = options.styleCatalog.map((entry) => `${entry.slug} | ${entry.label}`).join("\n");

  const content: Anthropic.ContentBlockParam[] = [
    { type: "text", text: "Front photo of the bonsai:" },
    imageBlock(options.frontImage),
  ];

  if (options.leafImage) {
    content.push({ type: "text", text: "Close-up of a leaf or needle from the same tree:" });
    content.push(imageBlock(options.leafImage));
  }

  content.push({
    type: "text",
    text: [
      options.wantSpecies
        ? `Identify the most likely species. Choose from this catalog when possible (format: slug | common name | latin name):\n${speciesList}\n\nReturn your top 3 species ranked by confidence (0-1). Use the catalog slug when the species matches a catalog entry; use slug null with your own label only if nothing in the catalog fits.`
        : "Return an empty species array.",
      options.wantStyles
        ? `Identify the bonsai style from the front photo. Choose from exactly these styles (format: slug | name):\n${styleList}\n\nReturn your top 3 styles ranked by confidence (0-1).`
        : "Return an empty styles array.",
    ].join("\n\n"),
  });

  const raw = await createStructuredMessage({
    system:
      "You are a bonsai species and style identification assistant. You analyze photos of bonsai trees " +
      "and identify the species (from bark, foliage, leaf shape, growth habit) and the bonsai style " +
      "(from trunk line, branch placement, and silhouette). Be honest about uncertainty: confidences " +
      "should reflect what the photo actually supports.",
    content,
    schema: SUGGESTION_SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 2048,
  });

  const result = raw as ClaudeSuggestionResult;

  return {
    species: Array.isArray(result.species) ? result.species.slice(0, 3) : [],
    styles: Array.isArray(result.styles) ? result.styles.slice(0, 3) : [],
  };
}

// --- Design Studio: target state -------------------------------------------

export type DesignTargetResult = {
  plan: TargetStatePlan;
  editInstruction: string;
};

const DESIGN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["assessment", "target", "stagedPlan", "cautions", "editInstruction"],
  properties: {
    assessment: {
      type: "object",
      additionalProperties: false,
      required: ["trunk", "nebari", "branches", "foliage", "healthFlags"],
      properties: {
        trunk: { type: "string" },
        nebari: { type: "string" },
        branches: { type: "string" },
        foliage: { type: "string" },
        healthFlags: { type: "array", items: { type: "string" } },
      },
    },
    target: {
      type: "object",
      additionalProperties: false,
      required: ["styleSlug", "styleLabel", "horizonYears", "silhouette", "keyMoves", "rationale"],
      properties: {
        styleSlug: { type: ["string", "null"] },
        styleLabel: { type: "string" },
        horizonYears: { type: "integer" },
        silhouette: { type: "string" },
        keyMoves: { type: "array", items: { type: "string" } },
        rationale: { type: "string" },
      },
    },
    stagedPlan: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["stage", "timing", "actions"],
        properties: {
          stage: { type: "string" },
          timing: { type: "string" },
          actions: { type: "array", items: { type: "string" } },
        },
      },
    },
    cautions: { type: "array", items: { type: "string" } },
    editInstruction: {
      type: "string",
      description: "Image-editing instruction for rendering the target state photo",
    },
  },
} as const;

export type DesignBrief = {
  mode: TargetStateMode;
  brief: string | null;
  targetStyleLabel: string | null;
  horizonYears: number | null;
};

export async function designTargetState(options: {
  frontImage: ImageInput;
  extraImages: ImageInput[];
  speciesLabel: string;
  speciesLatin: string | null;
  currentStyleLabel: string;
  developmentPlan: string | null;
  styleCatalog: CatalogEntry[];
  designBrief: DesignBrief;
}): Promise<DesignTargetResult> {
  const styleList = options.styleCatalog.map((entry) => `${entry.slug} | ${entry.label}`).join("\n");
  const content: Anthropic.ContentBlockParam[] = [
    { type: "text", text: "Current front photo of the bonsai (the most recent capture):" },
    imageBlock(options.frontImage),
  ];

  for (const [index, image] of options.extraImages.entries()) {
    content.push({ type: "text", text: `Earlier photo ${index + 1} of the same tree (for context on its development):` });
    content.push(imageBlock(image));
  }

  const briefText = options.designBrief.mode === "directed"
    ? [
        "The owner has given a design brief. Treat it as the constraint set; if any part of it is horticulturally unwise for this species, say so in cautions and adapt the plan to the closest safe interpretation.",
        options.designBrief.brief ? `Brief: ${options.designBrief.brief}` : null,
        options.designBrief.targetStyleLabel ? `Requested target style: ${options.designBrief.targetStyleLabel}` : null,
        options.designBrief.horizonYears ? `Time horizon: about ${options.designBrief.horizonYears} years` : null,
      ].filter((line): line is string => line !== null).join("\n")
    : "Design the best achievable target for this tree entirely from what you see. You may keep the declared style or propose a better-suited one — explain why in the rationale. Choose a realistic time horizon.";

  content.push({
    type: "text",
    text: [
      `Species: ${options.speciesLabel}${options.speciesLatin ? ` (${options.speciesLatin})` : ""}.`,
      `Declared style: ${options.currentStyleLabel}.`,
      options.developmentPlan ? `The owner's current development notes:\n${options.developmentPlan}` : null,
      briefText,
      `Style catalog (format: slug | name):\n${styleList}`,
      "Produce:",
      "1. A structural assessment of the tree as photographed (trunk line and taper, nebari, branch placement, foliage condition, any health flags).",
      "2. A target design: the style (slug from the catalog, or null with a label for something outside it), a realistic time horizon in years, a description of the target silhouette, the key structural moves to get there, and the rationale.",
      "3. A staged development plan: 3-6 stages, each with horticulturally correct timing for this species (seasons matter: repotting windows, pruning response, wiring periods).",
      "4. Cautions: risks and things not to do to this species.",
      "5. editInstruction: a single, precise instruction for a photo-editing AI model that will transform the CURRENT photo into the TARGET state. It must begin by pinning everything that has to stay identical (this exact tree: same trunk shape and bark texture, same pot unless the plan changes it, same viewpoint, same background and lighting), then describe only the visual changes (foliage pad shapes and positions, apex, branch removals, deadwood, height change). Write it so the result still looks like a photograph of this same physical tree, matured.",
    ].filter((line): line is string => line !== null).join("\n\n"),
  });

  const raw = await createStructuredMessage({
    system:
      "You are a master bonsai artist and horticulturist advising on the long-term design of a specific tree. " +
      "You design achievable target states: ambitious enough to be worth years of work, conservative enough to " +
      "keep the tree healthy. Timing advice must be correct for the species. You never propose work that would " +
      "endanger the tree.",
    content,
    schema: DESIGN_SCHEMA as unknown as Record<string, unknown>,
    maxTokens: 8192,
  });

  const result = raw as TargetStatePlan["assessment"] extends never ? never : {
    assessment: TargetStatePlan["assessment"];
    target: TargetStatePlan["target"];
    stagedPlan: TargetStatePlan["stagedPlan"];
    cautions: string[];
    editInstruction: string;
  };

  return {
    plan: {
      assessment: result.assessment,
      target: result.target,
      stagedPlan: result.stagedPlan,
      cautions: result.cautions,
    },
    editInstruction: result.editInstruction,
  };
}

export function getClaudeModelId() {
  return CLAUDE_MODEL;
}

// Users should see "the AI account is out of credits", not a JSON dump.
function toFriendlyAiError(error: unknown): Error {
  if (error instanceof Anthropic.APIError) {
    const body = error.error as { error?: { message?: string } } | undefined;
    const detail = body?.error?.message ?? error.message;
    return new Error(`The AI request failed: ${detail}`);
  }

  return error instanceof Error ? error : new Error(String(error));
}
