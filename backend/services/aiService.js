const Preferences = require("@/models/preferences");
const { AppError } = require("@/middleware/errorHandling");
const logger = require("@/utils/logger");

const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

/**
 * Pull a JSON object out of a model response that may be wrapped in prose or
 * ```json fences.
 */
const parseJsonResponse = (raw) => {
  if (!raw || typeof raw !== "string") {
    throw new AppError("AI returned an empty response", 502, true);
  }

  let text = raw.trim();

  // Strip ```json ... ``` / ``` ... ``` fences if present.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    text = fenced[1].trim();
  }

  // Fall back to the outermost braces.
  if (!text.startsWith("{")) {
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first !== -1 && last !== -1 && last > first) {
      text = text.slice(first, last + 1);
    }
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new AppError(
      "Failed to parse AI JSON response",
      502,
      true,
      error,
      { raw },
    );
  }
};

const callOpenai = async ({ apiKey, model, system, user, images, maxTokens }) => {
  const content = images.length
    ? [
        { type: "text", text: user },
        ...images.map((img) => ({
          type: "image_url",
          image_url: { url: `data:${img.mediaType};base64,${img.data}` },
        })),
      ]
    : user;

  const response = await fetch(OPENAI_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    // Не задаём temperature (новые модели GPT-5/o-серии принимают только дефолт)
    // и используем max_completion_tokens вместо устаревшего max_tokens, который
    // эти модели отклоняют с ошибкой 400.
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      ...(maxTokens ? { max_completion_tokens: maxTokens } : {}),
      messages: [
        { role: "system", content: system },
        { role: "user", content },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new AppError(
      `OpenAI request failed (${response.status}): ${detail}`,
      response.status,
      true,
      null,
      { detail },
    );
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content;
};

const callAnthropic = async ({
  apiKey,
  model,
  system,
  user,
  images,
  maxTokens,
}) => {
  const content = images.length
    ? [
        { type: "text", text: user },
        ...images.map((img) => ({
          type: "image",
          source: {
            type: "base64",
            media_type: img.mediaType,
            data: img.data,
          },
        })),
      ]
    : user;

  const response = await fetch(ANTHROPIC_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens || 1500,
      system,
      messages: [{ role: "user", content }],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new AppError(
      `Anthropic request failed (${response.status})`,
      response.status,
      true,
      null,
      { detail },
    );
  }

  const data = await response.json();
  return data.content?.[0]?.text;
};

/**
 * Provider-agnostic helper that asks the configured AI provider for a single
 * JSON object. Reads provider/key/model from the singleton Preferences doc.
 *
 * @param {object[]} [params.images] optional vision inputs: { mediaType, data (base64) }
 * @param {number} [params.maxTokens] optional output cap (Anthropic default 1500);
 *   raise it for larger JSON payloads (e.g. a full cleaned call dialog) to avoid
 *   truncation that would make the response invalid JSON.
 * @param {boolean} [params.requireActive=true] when false, only a configured
 *   provider key is required — the global `ai.isActive` (AI-guide) master switch is
 *   not enforced. Used by speech summaries, which have their own feature toggle.
 * @returns {Promise<{ data: object, provider: string, model: string }>}
 */
exports.generateJson = async ({
  system,
  user,
  images = [],
  maxTokens,
  requireActive = true,
}) => {
  const preferences = await Preferences.findOne({});
  const ai = preferences?.ai;

  if (requireActive && !ai?.isActive) {
    throw new AppError("AI features are disabled", 400, true);
  }

  const provider = ai?.provider;
  const providerConfig = provider ? ai[provider] : null;
  const apiKey = providerConfig?.apiKey;
  const model = providerConfig?.model;

  if (!apiKey) {
    throw new AppError(`API key for ${provider || "AI provider"} is not set`, 400, true);
  }

  logger.log("info", "Requesting AI completion", { provider, model });

  const raw =
    provider === "openai"
      ? await callOpenai({ apiKey, model, system, user, images, maxTokens })
      : await callAnthropic({ apiKey, model, system, user, images, maxTokens });

  return { data: parseJsonResponse(raw), provider, model };
};
