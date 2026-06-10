const path = require("path");

const Preferences = require("@/models/preferences");
const { AppError } = require("@/middleware/errorHandling");
const logger = require("@/utils/logger");
const storage = require("@/services/storage");
const aiService = require("./aiService");
const buildSummaryPrompt = require("@/prompts/callSummary");
const transcriptionPrompt = require("@/prompts/transcription");

const OPENAI_TRANSCRIPTIONS_ENDPOINT =
  "https://api.openai.com/v1/audio/transcriptions";
const MAX_AUDIO_SIZE_BYTES = 25 * 1024 * 1024;
// Лимит вывода для пост-обработки: возвращаем весь очищенный диалог + итог одним
// JSON, поэтому нужен запас, иначе Anthropic (дефолт 1500) обрежет ответ и JSON
// станет невалидным — итог и очищенный диалог потеряются.
const SUMMARY_MAX_TOKENS = 4096;

// Yandex SpeechKit STT v3 (асинхронное распознавание длинных аудио).
const YANDEX_RECOGNIZE_ENDPOINT =
  "https://stt.api.cloud.yandex.net/stt/v3/recognizeFileAsync";
const YANDEX_GET_RECOGNITION_ENDPOINT =
  "https://stt.api.cloud.yandex.net/stt/v3/getRecognition";
const YANDEX_OPERATION_ENDPOINT =
  "https://operation.api.cloud.yandex.net/operations";
const YANDEX_POLL_INTERVAL_MS = 3000;
const YANDEX_MAX_POLL_ATTEMPTS = 120; // ~6 минут ожидания операции
// Передаём аудио инлайном (base64 в теле запроса), без Object Storage —
// поэтому держим консервативный лимит на размер файла.
const YANDEX_MAX_AUDIO_SIZE_BYTES = 100 * 1024 * 1024;
// Yandex принимает только эти контейнеры в поле containerAudio.
const YANDEX_CONTAINER_BY_EXTENSION = {
  mp3: "MP3",
  wav: "WAV",
  ogg: "OGG_OPUS",
  oga: "OGG_OPUS",
  opus: "OGG_OPUS",
};

const SUPPORTED_AUDIO_EXTENSIONS = new Set([
  "mp3",
  "mp4",
  "mpeg",
  "mpga",
  "m4a",
  "wav",
  "webm",
  "ogg",
  "oga",
  "opus",
]);
const SUPPORTED_AUDIO_MIME_TYPES = new Set([
  "audio/mpeg",
  "audio/mp4",
  "audio/m4a",
  "audio/mpga",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
  "audio/ogg",
  "audio/opus",
  "video/mp4",
  "video/mpeg",
  "video/webm",
]);

const getAttachmentMimeType = (attachment) =>
  attachment?.mimetype || attachment?.mimeType || "application/octet-stream";

const getAttachmentExtension = (attachment) =>
  path.extname(attachment?.name || attachment?.originalName || "")
    .slice(1)
    .toLowerCase();

const isOpenaiSpeechModel = (model) =>
  /^(whisper-1|gpt-4o(?:-mini)?-transcribe(?:-diarize)?(?:-\d{4}-\d{2}-\d{2})?)$/.test(
    model,
  );

const isDiarizeModel = (model) => /^gpt-4o-transcribe-diarize/.test(model);

const isAudioAttachment = (attachment) => {
  const mimeType = getAttachmentMimeType(attachment);
  const extension = getAttachmentExtension(attachment);

  return (
    SUPPORTED_AUDIO_EXTENSIONS.has(extension) ||
    SUPPORTED_AUDIO_MIME_TYPES.has(mimeType)
  );
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getSpeechToTextConfig = async () => {
  const preferences = await Preferences.findOne({});
  const speechToText = preferences?.ai?.speechToText;

  if (!speechToText?.isActive) {
    throw new AppError("Speech recognition is disabled", 400, true);
  }

  const provider = speechToText.provider || "openai";

  if (provider === "yandex") {
    const yandex = speechToText.yandex || {};

    if (!yandex.apiKey) {
      throw new AppError(
        "Yandex SpeechKit API key is not set",
        400,
        true,
      );
    }

    return {
      provider,
      apiKey: yandex.apiKey,
      folderId: yandex.folderId || "",
      model: yandex.model || "general",
    };
  }

  if (!speechToText.apiKey) {
    throw new AppError(
      "OpenAI speech recognition API key is not set",
      400,
      true,
    );
  }

  if (!isOpenaiSpeechModel(speechToText.model)) {
    throw new AppError(
      "Selected model does not support speech recognition",
      400,
      true,
    );
  }

  return { provider, apiKey: speechToText.apiKey, model: speechToText.model };
};

const getSpeakerLabel = (speaker, speakerMap, previousSpeaker) => {
  const normalized = String(speaker || "speaker").trim() || "speaker";

  if (!speakerMap.has(normalized)) {
    if (speakerMap.size >= 2) {
      return previousSpeaker || "Участник 2";
    }

    speakerMap.set(normalized, `Участник ${speakerMap.size + 1}`);
  }

  return speakerMap.get(normalized);
};

const normalizeSegments = (segments = []) => {
  const speakerMap = new Map();
  let previousSpeaker = "";

  return segments
    .filter((segment) => segment?.text)
    .map((segment) => {
      const speaker = getSpeakerLabel(
        segment.speaker,
        speakerMap,
        previousSpeaker,
      );
      previousSpeaker = speaker;

      return {
        speaker,
        text: String(segment.text).trim(),
        start: typeof segment.start === "number" ? segment.start : undefined,
        end: typeof segment.end === "number" ? segment.end : undefined,
      };
    });
};

const compactSegments = (segments) =>
  segments.reduce((acc, segment) => {
    const previous = acc[acc.length - 1];

    if (previous?.speaker === segment.speaker) {
      previous.text = `${previous.text} ${segment.text}`.trim();
      previous.end = segment.end ?? previous.end;
      return acc;
    }

    acc.push({ ...segment });
    return acc;
  }, []);

const formatSegments = (segments) =>
  compactSegments(segments)
    .map((segment) => `${segment.speaker}: ${segment.text}`)
    .join("\n\n");

const normalizeSummary = (parsed) => {
  const value = parsed?.summary ?? parsed?.description;
  return typeof value === "string" ? value.trim() : "";
};

// Терпимо разбираем диалог: модель может вернуть массив объектов {speaker,text}
// либо массив строк вида "Оператор: текст". Оба варианта приводим к {speaker,text}.
const normalizeDialog = (parsed) => {
  if (!Array.isArray(parsed?.dialog)) return [];

  return parsed.dialog
    .map((turn) => {
      if (turn && typeof turn === "object" && typeof turn.text === "string") {
        return {
          speaker: String(turn.speaker || "Участник").trim() || "Участник",
          text: turn.text.trim(),
        };
      }

      if (typeof turn === "string" && turn.trim()) {
        const match = turn.match(/^\s*([^:\n]{1,40}):\s*([\s\S]+)$/);
        if (match) {
          return { speaker: match[1].trim(), text: match[2].trim() };
        }
        return { speaker: "Участник", text: turn.trim() };
      }

      return null;
    })
    .filter((turn) => turn && turn.text);
};

// Пост-обработка распознанной речи в очищенный диалог + итог + заголовок.
// Итог формирует основной (глобальный) AI-провайдер из настроек — независимо от
// того, чем распознавали речь (OpenAI или Yandex): глобальная модель обычно
// сильнее дешёвой gpt-4o-mini и делает итог качественнее. generateJson бросит
// исключение, если AI выключен/не настроен, — его перехватит вызывающий код.
const summarizeDialog = async ({ segments, context = {} }) => {
  if (!segments.length) return { summary: "", title: "", dialog: [] };

  const { system, user } = buildSummaryPrompt({
    segments: compactSegments(segments),
    context,
  });

  // Итог звонка завязан на собственный тумблер распознавания речи, поэтому не
  // требуем общий тумблер AI-функций (ai.isActive) — достаточно ключа провайдера.
  const { data: parsed } = await aiService.generateJson({
    system,
    user,
    maxTokens: SUMMARY_MAX_TOKENS,
    requireActive: false,
  });

  const summary = normalizeSummary(parsed);
  const title = typeof parsed?.title === "string" ? parsed.title.trim() : "";
  const dialog = normalizeDialog(parsed);

  return { summary, title, dialog };
};

// --- OpenAI: распознавание речи -------------------------------------------

const transcribeWithOpenai = async (attachment, { apiKey, model }) => {
  const buffer = await storage.getObjectBuffer(attachment.name);

  if (buffer.length > MAX_AUDIO_SIZE_BYTES) {
    throw new AppError("Audio file is larger than 25 MB", 400, true);
  }
  const fileName = attachment.originalName || attachment.name;
  const formData = new FormData();
  formData.append(
    "file",
    new Blob([buffer], { type: getAttachmentMimeType(attachment) }),
    fileName,
  );
  formData.append("model", model);

  if (isDiarizeModel(model)) {
    formData.append("response_format", "diarized_json");
    formData.append("chunking_strategy", "auto");
    formData.append("language", "ru");
  } else {
    formData.append("response_format", "json");
    formData.append("language", "ru");
    formData.append("prompt", transcriptionPrompt);
  }

  logger.log("info", "Requesting OpenAI speech recognition", {
    model,
    attachment: attachment.name,
  });

  const response = await fetch(OPENAI_TRANSCRIPTIONS_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new AppError(
      `OpenAI speech recognition failed (${response.status})`,
      response.status,
      true,
      null,
      { detail },
    );
  }

  const data = await response.json();
  const rawSegments = normalizeSegments(data.segments);
  const segments = rawSegments.length
    ? compactSegments(rawSegments)
    : compactSegments([{ speaker: "Участник 1", text: data.text || "" }]);

  return { segments, fallbackText: data.text || "", model };
};

// --- Yandex SpeechKit: распознавание речи ----------------------------------

const yandexAuthHeaders = (apiKey, folderId) => {
  const headers = { Authorization: `Api-Key ${apiKey}` };
  if (folderId) headers["x-folder-id"] = folderId;
  return headers;
};

// Извлекаем реплики из потока результатов getRecognition (NDJSON: по одному
// JSON-объекту { result: {...} } на строку). Берём финальные распознавания и
// тег говорящего из слов/канала; диаризацию нормализуем до двух участников.
const parseYandexResults = (rawText) => {
  const results = [];

  for (const line of rawText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (parsed?.result) results.push(parsed.result);
  }

  // Yandex присылает по каждой реплике сырой `final`, а затем нормализованный
  // `finalRefinement`. Если уточнения есть, берём только их — иначе одна и та же
  // фраза попадёт в диалог дважды (сырой + нормализованный варианты).
  const hasRefinement = results.some(
    (result) => result.finalRefinement?.normalizedText,
  );

  const segments = [];

  for (const result of results) {
    const event = hasRefinement
      ? result.finalRefinement?.normalizedText
      : result.final;
    const alternatives = event?.alternatives;
    if (!Array.isArray(alternatives) || !alternatives.length) continue;

    const text = alternatives
      .map((alt) => alt?.text)
      .filter(Boolean)
      .join(" ")
      .trim();
    if (!text) continue;

    const words = alternatives[0]?.words;
    const speaker =
      words?.[0]?.speakerTag ?? result.speakerTag ?? result.channelTag ?? "1";

    const startMs = Number(words?.[0]?.startTimeMs);
    const endMs = Number(words?.[words.length - 1]?.endTimeMs);

    segments.push({
      speaker: String(speaker),
      text,
      start: Number.isFinite(startMs) ? startMs / 1000 : undefined,
      end: Number.isFinite(endMs) ? endMs / 1000 : undefined,
    });
  }

  return segments;
};

const transcribeWithYandex = async (
  attachment,
  { apiKey, folderId, model },
) => {
  const extension = getAttachmentExtension(attachment);
  const containerType = YANDEX_CONTAINER_BY_EXTENSION[extension];

  if (!containerType) {
    throw new AppError(
      "Yandex SpeechKit supports only MP3, WAV and OGG/OPUS audio",
      400,
      true,
    );
  }

  const buffer = await storage.getObjectBuffer(attachment.name);

  if (buffer.length > YANDEX_MAX_AUDIO_SIZE_BYTES) {
    throw new AppError("Audio file is larger than 100 MB", 400, true);
  }

  logger.log("info", "Requesting Yandex SpeechKit recognition", {
    model,
    attachment: attachment.name,
  });

  const startResponse = await fetch(YANDEX_RECOGNIZE_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...yandexAuthHeaders(apiKey, folderId),
    },
    body: JSON.stringify({
      content: buffer.toString("base64"),
      recognitionModel: {
        model: model || "general",
        audioFormat: {
          containerAudio: { containerAudioType: containerType },
        },
        textNormalization: {
          textNormalization: "TEXT_NORMALIZATION_ENABLED",
          profanityFilter: false,
          literatureText: true,
        },
        languageRestriction: {
          restrictionType: "WHITELIST",
          languageCode: ["ru-RU"],
        },
        audioProcessingType: "FULL_DATA",
      },
      speakerLabeling: { speakerLabeling: "SPEAKER_LABELING_ENABLED" },
    }),
  });

  if (!startResponse.ok) {
    const detail = await startResponse.text();
    throw new AppError(
      `Yandex SpeechKit request failed (${startResponse.status})`,
      startResponse.status,
      true,
      null,
      { detail },
    );
  }

  const operation = await startResponse.json();
  const operationId = operation?.id;

  if (!operationId) {
    throw new AppError("Yandex SpeechKit returned no operation id", 502, true);
  }

  // Ждём завершения операции распознавания.
  let done = false;
  for (let attempt = 0; attempt < YANDEX_MAX_POLL_ATTEMPTS; attempt += 1) {
    await sleep(YANDEX_POLL_INTERVAL_MS);

    const statusResponse = await fetch(
      `${YANDEX_OPERATION_ENDPOINT}/${operationId}`,
      { headers: yandexAuthHeaders(apiKey, folderId) },
    );

    if (!statusResponse.ok) {
      const detail = await statusResponse.text();
      throw new AppError(
        `Yandex SpeechKit operation check failed (${statusResponse.status})`,
        statusResponse.status,
        true,
        null,
        { detail },
      );
    }

    const status = await statusResponse.json();

    if (status?.error) {
      throw new AppError(
        `Yandex SpeechKit recognition error: ${status.error.message || "unknown"}`,
        502,
        true,
        null,
        { detail: status.error },
      );
    }

    if (status?.done) {
      done = true;
      break;
    }
  }

  if (!done) {
    throw new AppError("Yandex SpeechKit recognition timed out", 504, true);
  }

  const resultResponse = await fetch(
    `${YANDEX_GET_RECOGNITION_ENDPOINT}?operation_id=${operationId}`,
    { headers: yandexAuthHeaders(apiKey, folderId) },
  );

  if (!resultResponse.ok) {
    const detail = await resultResponse.text();
    throw new AppError(
      `Yandex SpeechKit result fetch failed (${resultResponse.status})`,
      resultResponse.status,
      true,
      null,
      { detail },
    );
  }

  const rawText = await resultResponse.text();
  const rawSegments = normalizeSegments(parseYandexResults(rawText));
  const fallbackText = rawSegments.map((segment) => segment.text).join(" ");
  const segments = rawSegments.length
    ? compactSegments(rawSegments)
    : compactSegments([{ speaker: "Участник 1", text: fallbackText }]);

  return { segments, fallbackText, model };
};

exports.isAudioAttachment = isAudioAttachment;

exports.transcribeAttachment = async (attachment, context = {}) => {
  if (!isAudioAttachment(attachment)) {
    throw new AppError("Attachment is not a supported audio file", 400, true);
  }

  const config = await getSpeechToTextConfig();
  const { provider } = config;

  const { segments: recognizedSegments, fallbackText, model } =
    provider === "yandex"
      ? await transcribeWithYandex(attachment, config)
      : await transcribeWithOpenai(attachment, config);

  let segments = recognizedSegments;
  let summary = "";
  let title = "";
  let cleanedDialog = [];
  let summaryError = "";

  try {
    const result = await summarizeDialog({ segments, context });
    summary = result.summary || "";
    title = result.title || "";
    cleanedDialog = result.dialog || [];
  } catch (error) {
    // Итог/диалог не сформированы — показываем сырые реплики, но причину
    // возвращаем наружу (summaryError), чтобы вызывающий код записал её в лог
    // заявки и не рапортовал ложный «успех» (напр. "AI features are disabled",
    // неверная модель/ключ, ошибка провайдера).
    summaryError = error.message || "Не удалось сформировать итог звонка";
    logger.log("error", "Speech summary/dialog generation failed", {
      attachment: attachment.name,
      error: error.message,
      stack: error.stack,
    });
  }

  // Если ИИ вернул очищенный диалог (без дублей, слов-паразитов, с исправленными
  // именами и ролями), показываем именно его. Иначе оставляем сырые реплики.
  if (cleanedDialog.length) {
    segments = compactSegments(cleanedDialog);
  }

  const rawText = segments.length ? formatSegments(segments) : fallbackText;
  const text = summary || rawText;

  if (!text) {
    throw new AppError("Speech recognition returned an empty result", 502, true);
  }

  return {
    text,
    summary,
    title,
    segments,
    model,
    generatedAt: new Date(),
    summaryError,
  };
};
