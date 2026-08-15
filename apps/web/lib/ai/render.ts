import { getGeminiApiKey, getImageProviderName } from "../env";

// Photoreal target-state rendering. This is an image-EDITING task (transform a
// photo of this exact tree), not text-to-image — Anthropic has no image
// generation, so this half of the pipeline uses a dedicated image model behind
// a small provider interface:
//   gemini — Google's Gemini image model (identity-preserving photo edits)
//   mock   — returns the source photo unchanged (development / E2E without a key)
//   none   — rendering disabled; the Studio still delivers the design plan

export type RenderRequest = {
  sourceBase64: string;
  sourceMimeType: string;
  instruction: string;
};

export type RenderResult = {
  imageBase64: string;
  mimeType: string;
  provider: string;
};

export function getRenderProviderName() {
  return getImageProviderName();
}

export async function renderTargetImage(request: RenderRequest): Promise<RenderResult | null> {
  const provider = getImageProviderName();

  if (provider === "none") {
    return null;
  }

  if (provider === "mock") {
    return {
      imageBase64: request.sourceBase64,
      mimeType: request.sourceMimeType,
      provider: "mock",
    };
  }

  return renderWithGemini(request);
}

const GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image";

async function renderWithGemini(request: RenderRequest): Promise<RenderResult> {
  const apiKey = getGeminiApiKey();

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured but BONSAI_IMAGE_PROVIDER is 'gemini'.");
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { inline_data: { mime_type: request.sourceMimeType, data: request.sourceBase64 } },
              { text: request.instruction },
            ],
          },
        ],
        generationConfig: {
          responseModalities: ["IMAGE", "TEXT"],
        },
      }),
      signal: AbortSignal.timeout(120_000),
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Gemini render failed (${response.status}): ${detail.slice(0, 300)}`);
  }

  const payload = (await response.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          inlineData?: { mimeType?: string; data?: string };
          inline_data?: { mime_type?: string; data?: string };
        }>;
      };
    }>;
  };

  for (const part of payload.candidates?.[0]?.content?.parts ?? []) {
    const inline = part.inlineData ?? part.inline_data;
    const data = inline && ("data" in inline ? inline.data : undefined);

    if (data) {
      const mimeType = (part.inlineData?.mimeType ?? part.inline_data?.mime_type) || "image/png";
      return { imageBase64: data, mimeType, provider: GEMINI_IMAGE_MODEL };
    }
  }

  throw new Error("Gemini returned no image in the response.");
}
