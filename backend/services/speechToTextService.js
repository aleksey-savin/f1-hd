const path = require("path");

const Preferences = require("@/models/preferences");
const { Ticket } = require("@/models/ticket");
const { AppError } = require("@/middleware/errorHandling");
const { logAiTicketEvent } = require("./aiTicketLog");
const { readStoredSecret } = require("@/helpers/preferencesSecrets");
const { describeAiError } = require("@/services/aiErrors");
const aiHealth = require("@/services/ai/health");
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
// Проба канала для кнопки проверки в настройках. Рабочий путь (v3) требует
// файл и асинхронную операцию — для проверки настроек он не годится, поэтому
// у пробы своя, синхронная версия API: те же ключ и каталог, ответ за секунду.
const YANDEX_STT_PROBE_ENDPOINT =
  "https://stt.api.cloud.yandex.net/speech/v1/stt:recognize";
// Локальный сервер распознавания (faster-whisper-server, speaches, LocalAI,
// vLLM) отдаёт OpenAI-совместимый /v1/audio/transcriptions. Предел по времени —
// как у локального чата: неверный адрес в закрытой сети висит молча.
const LOCAL_SPEECH_TIMEOUT_MS = 5 * 60 * 1000;
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

// Основной провайдер, у которого распознавание может взять данные. Пары не
// произвольные: у OpenAI один ключ на чат и на расшифровку, у Яндекса один ключ
// Cloud открывает и AI Studio, и SpeechKit, а локальный сервер — это один адрес.
// Остальные сочетания (чат в Anthropic, расшифровка в OpenAI) общего ничего не
// имеют, и переключатель для них смысла не несёт.
const CREDENTIALS_SOURCE = {
  openai: "openai",
  yandex: "yandexai",
  local: "local",
};

exports.canShareCredentials = (chatProvider, speechProvider) =>
  !!speechProvider && CREDENTIALS_SOURCE[speechProvider] === chatProvider;

/**
 * Данные канала распознавания: свои или взятые у основного провайдера.
 * Модель всегда своя — каталог расшифровки и каталог чата не пересекаются.
 *
 * @param {object} ai группа настроек ИИ (уже слитая с черновиком формы)
 * @returns {{ provider: string, apiKey: string, folderId: string, baseUrl: string, model: string, shared: boolean }}
 */
const resolveSpeechConfig = (ai) => {
  const speechToText = ai?.speechToText || {};
  const provider = speechToText.provider || "openai";
  const own =
    provider === "yandex"
      ? speechToText.yandex || {}
      : provider === "local"
        ? speechToText.local || {}
        : speechToText;

  const shared =
    !!speechToText.useProviderCredentials &&
    exports.canShareCredentials(ai?.provider, provider);
  const source = shared ? ai[ai.provider] || {} : own;

  return {
    provider,
    // В базе ключ лежит шифртекстом secretBox — наружу уходит расшифрованный
    apiKey: readStoredSecret(source.apiKey),
    folderId: source.folderId || "",
    baseUrl: source.baseUrl || "",
    model: own.model || (provider === "yandex" ? "general" : ""),
    shared,
  };
};

exports.resolveSpeechConfig = resolveSpeechConfig;

const getSpeechToTextConfig = async () => {
  const preferences = await Preferences.findOne({});
  const speechToText = preferences?.ai?.speechToText;

  if (!speechToText?.isActive) {
    throw new AppError("Speech recognition is disabled", 400, true);
  }

  const config = resolveSpeechConfig(preferences.ai?.toObject?.() ?? preferences.ai);

  if (config.provider === "yandex") {
    if (!config.apiKey) {
      throw new AppError("Yandex SpeechKit API key is not set", 400, true);
    }

    return config;
  }

  if (config.provider === "local") {
    if (!config.baseUrl) {
      throw new AppError("Local speech base URL is not set", 400, true);
    }
    if (!config.model) {
      throw new AppError("Local speech model is not set", 400, true);
    }

    return {
      ...config,
      endpoint: `${aiService.buildLocalBaseUrl(config.baseUrl)}/audio/transcriptions`,
      timeoutMs: LOCAL_SPEECH_TIMEOUT_MS,
    };
  }

  if (!config.apiKey) {
    throw new AppError(
      "OpenAI speech recognition API key is not set",
      400,
      true,
    );
  }

  // Проверка каталога OpenAI: их имена моделей фиксированы, и чат-модель в этом
  // поле — заведомо неработающая настройка. У локального сервера имена свои
  if (!isOpenaiSpeechModel(config.model)) {
    throw new AppError(
      "Selected model does not support speech recognition",
      400,
      true,
    );
  }

  return config;
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

// Тот же путь обслуживает локальные серверы распознавания: у них
// OpenAI-совместимый /v1/audio/transcriptions, отличается только адрес, а ключа
// они обычно не спрашивают.
const transcribeWithOpenai = async (
  attachment,
  {
    apiKey,
    model,
    endpoint = OPENAI_TRANSCRIPTIONS_ENDPOINT,
    timeoutMs,
    provider = "openai",
  },
) => {
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

  logger.log("info", "Requesting speech recognition", {
    provider,
    model,
    attachment: attachment.name,
  });

  const response = await fetch(endpoint, {
    method: "POST",
    // Локальные серверы ключа не спрашивают — пустой заголовок не шлём
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    body: formData,
    ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new AppError(
      `Speech recognition failed (${response.status})`,
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

    // alternatives — конкурирующие гипотезы одной реплики, а не её продолжение:
    // склеивая их, мы получали одну фразу дважды. Первая — самая вероятная, из
    // неё же ниже берём спикера и таймкоды.
    const text = String(alternatives[0]?.text || "").trim();
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

// Переходы pending/error перезаписывают поддокумент speechToText целиком —
// переносим в них прошлый результат, иначе повторный прогон стирает итог и
// реплики, а при ошибке они теряются совсем.
exports.carryOverSpeechResult = (previous) => ({
  text: previous?.text || "",
  summary: previous?.summary || "",
  segments: (previous?.segments || []).map(({ speaker, text, start, end }) => ({
    speaker,
    text,
    start,
    end,
  })),
  model: previous?.model || undefined,
  generatedAt: previous?.generatedAt || undefined,
});

exports.transcribeAttachment = async (attachment, context = {}) => {
  if (!isAudioAttachment(attachment)) {
    throw new AppError("Attachment is not a supported audio file", 400, true);
  }

  const config = await getSpeechToTextConfig();
  const { provider } = config;

  // Настоящие расшифровки и наполняют строку состояния канала в настройках
  let recognition;
  try {
    recognition =
      provider === "yandex"
        ? await transcribeWithYandex(attachment, config)
        : await transcribeWithOpenai(attachment, config);
  } catch (error) {
    await aiHealth.recordError(aiHealth.SPEECH, describeAiError(error));
    throw error;
  }

  const { segments: recognizedSegments, fallbackText, model } = recognition;

  // Реальная речь распознана, если ASR вернул непустой текст (а не единственный
  // пустой fallback-сегмент). Нужно вызывающему коду, чтобы НЕ подменять
  // описание/заголовок заявки при пустом аудио или возможной галлюцинации итога
  // на пустом входе.
  const hasRecognizedSpeech = recognizedSegments.some(
    (segment) => segment.text && segment.text.trim(),
  );

  // Канал ответил; «сработал» — только когда речь действительно нашлась
  await aiHealth.recordOk(aiHealth.SPEECH, { message: hasRecognizedSpeech });

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

  // text — плоская расшифровка диалога (реплики через «Имя: …»), и только она:
  // итог живёт в summary и в описании заявки, а его дубль здесь показывал одну
  // мысль дважды. Пустая расшифровка = ASR ничего не распознал; итог в этом
  // случае не подставляем — на пустом входе он галлюцинация.
  const text = hasRecognizedSpeech
    ? segments.length
      ? formatSegments(segments)
      : fallbackText.trim()
    : "";

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
    recognized: hasRecognizedSpeech,
  };
};

// Срок ожидания расшифровки вложения. Как и у руководства заявки, перезапуск
// процесса убивает работу без исключения: catch не сработает, статус останется
// pending, и в карточке навсегда закрутится спиннер. Запас тот же, что у гейта
// уведомлений (middleware/notifications.js): асинхронное распознавание Yandex
// опрашивается до шести минут, следом идёт AI-итог.
const PENDING_TTL_MS = 15 * 60 * 1000;

/**
 * Гасит зависшие расшифровки вложений при чтении заявки — карточка опрашивает
 * именно её. Живая расшифровка перепишет статус своим результатом.
 *
 * @param {object} ticket план-объект заявки (мутируется на месте)
 */
exports.expireStalePendingSpeech = async (ticket) => {
  const stale = (ticket?.attachments || []).filter((attachment) => {
    if (attachment?.speechToText?.status !== "pending") return false;
    const startedAt = attachment.speechToText.startedAt;
    // Вложения, начатые до появления startedAt, гасим сразу
    return (
      !startedAt || Date.now() - new Date(startedAt).getTime() >= PENDING_TTL_MS
    );
  });

  if (!stale.length) return ticket;

  const error = "распознавание прервалось, запустите его заново";

  for (const attachment of stale) {
    attachment.speechToText = {
      ...attachment.speechToText,
      status: "error",
      error,
    };
  }

  await Ticket.updateOne(
    { _id: ticket._id },
    {
      $set: {
        "attachments.$[stuck].speechToText.status": "error",
        "attachments.$[stuck].speechToText.error": error,
      },
    },
    {
      arrayFilters: [
        { "stuck.name": { $in: stale.map((item) => item.name) } },
      ],
    },
  ).catch(() => {});

  // Карточка отсылает к хронике заявки — там должно быть что прочитать
  await logAiTicketEvent(
    ticket._id,
    "Распознавание записи звонка прервалось: сервис перезапустился, пока оно шло",
    "warning",
  );

  return ticket;
};

/**
 * Проба канала распознавания для кнопки проверки в настройках: ключ отдаём
 * самому сервису, а не проверяем его на глаз. Ошибку наружу не бросаем — она и
 * есть результат проверки; успех пишем в состояние канала, неуспех — нет.
 *
 * @returns {Promise<{ ok: boolean, state: string, hint: string }>}
 */
exports.checkSpeechToText = async ({
  provider,
  apiKey,
  folderId,
  model,
  baseUrl,
}) => {
  // Локальному серверу ключ не нужен — ему нужен адрес
  if (!apiKey && provider !== "local") {
    return { ok: false, state: "Ключ распознавания не задан", hint: "" };
  }

  try {
    if (provider === "local") {
      if (!baseUrl) {
        return {
          ok: false,
          state: "Не указан адрес сервера распознавания",
          hint: "",
        };
      }

      // Каталог моделей — самая дешёвая проба: файл гонять не нужно
      const response = await fetch(
        `${aiService.buildLocalBaseUrl(baseUrl)}/models`,
        {
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
          signal: AbortSignal.timeout(15000),
        },
      );

      if (!response.ok) {
        const detail = await response.text();
        throw new AppError(
          `Local speech request failed (${response.status}): ${detail}`,
          response.status,
          true,
        );
      }
    } else if (provider === "yandex") {
      if (!folderId) {
        return {
          ok: false,
          state: "Не указан идентификатор каталога",
          hint: "Без каталога SpeechKit не примет запрос.",
        };
      }

      // 0,2 с тишины: самый дешёвый способ доказать, что ключ и каталог
      // рабочие, — файла в репозитории для этого не нужно.
      const silence = Buffer.alloc(16000 * 2 * 0.2);
      const query = new URLSearchParams({
        folderId,
        lang: "ru-RU",
        format: "lpcm",
        sampleRateHertz: "16000",
      });
      const response = await fetch(`${YANDEX_STT_PROBE_ENDPOINT}?${query}`, {
        method: "POST",
        headers: { Authorization: `Api-Key ${apiKey}` },
        body: silence,
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new AppError(
          `Yandex SpeechKit request failed (${response.status}): ${detail}`,
          response.status,
          true,
        );
      }
    } else {
      if (!isOpenaiSpeechModel(model)) {
        return {
          ok: false,
          state: "Выбранная модель не умеет распознавать речь",
          hint: "Загрузите список и выберите модель расшифровки.",
        };
      }

      const response = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new AppError(
          `OpenAI request failed (${response.status}): ${detail}`,
          response.status,
          true,
        );
      }
    }

    await aiHealth.recordOk(aiHealth.SPEECH);

    return { ok: true, state: "Сервис распознавания отвечает", hint: "" };
  } catch (error) {
    logger.log("warn", "Speech recognition check failed", {
      provider,
      error: error.message,
    });

    return { ok: false, ...describeAiError(error) };
  }
};
