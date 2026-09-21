# AI Integration — Implementation Notes

_Last updated: 2026-07-31. This document describes the AI features as currently
implemented, so the code can be reviewed and optimized later. It is a snapshot,
not a spec — verify against the code before relying on any detail._

## Overview

Five AI capabilities have been added:

1. **AI provider preferences** — admin chooses OpenAI, Anthropic, DeepSeek,
   Yandex AI Studio or a **self-hosted server** (Ollama, LM Studio, vLLM,
   llama.cpp, LocalAI — one option for all of them, they differ only by address)
   and stores the API key + model. Models are fetched live from the provider, and
   each outbound channel carries a health line plus a check action (see «Секция
   внешнего сервиса обязана отвечать, работает ли она» in the UX guide). Speech
   recognition has its own provider switch under the same section: **OpenAI**
   (API key + model), **Yandex SpeechKit** (API key + folder ID + `general`) or a
   **local** OpenAI-compatible server; a toggle lets it take the credentials from
   the chat provider when the pair actually shares any.
2. **AI ticket solution guide (experimental)** — generated **manually only**, via
   the button on the ticket page (auto-generation on ticket creation is disabled
   at the current stage). The configured provider generates either a step-by-step
   solution guide or a
   checklist of clarifying questions, using the ticket + comments + applicant +
   company context, its image/document attachments, **and the most relevant
   knowledge-base notes** (matched by company/category/applicant, used as a
   priority source; the used notes are shown as links). Shown interactively on
   the ticket page, regenerable on demand. Staff-only.
3. **Speech recognition / call summary** — staff can summarize audio attachments
   on ticket pages; new email-created tickets with audio attachments trigger the
   same process automatically in the background. OpenAI speech-to-text is used for
   recognition, followed by an AI cleanup/summary pass that produces both a
   structured Russian call summary and a short ticket title. On the ticket page
   the call **dialog** (diarized segments) is shown; the summary/title feed
   email-created tickets (see §3).
4. **AI ticket category detection** — on ticket creation the configured provider
   picks the best-matching `TicketCategory` from the ticket's title/description and
   the categories' own descriptions, filling `categoryId` only when it is empty. Runs
   for web-form, email- and Telegram-created tickets, and (for telephony) after the call
   summary replaces the description, so the category reflects the recognized call. A
   `aiCategory.status` badge shows progress (like the speech badge), and both the
   category and speech flows write start/end/error ticket-log entries (see §4).
5. **Subject reference** — on demand the assistant extracts the ticket's
   conceptual apparatus and writes a reference on any of those concepts (what it
   is, what it consists of, how it is deployed, common pitfalls, links to the
   vendor's documentation). The reference is about the subject, not the ticket, so
   it can be saved into the knowledge base and reused. Whatever the AI wrote into
   the ticket's own fields carries a mark, and the mark opens a correction that
   can grow into a prompt rule (see §5).

Design principle throughout: **provider-agnostic via the global `fetch`** (no
OpenAI/Anthropic SDK), matching the pre-existing `getAiModels` pattern. Output is
in Russian.

All LLM prompt text lives in **`backend/prompts/`** (one prompt per file, each with
a header comment stating what it does and where it is used), imported via the
`@/prompts` alias rather than inlined in services:
- `prompts/ticketGuide.js` — ticket solution-guide system prompt (§2);
- `prompts/callSummary.js` — call ASR post-processing prompt builder, `({ segments,
  context }) → { system, user }`; also owns the `SUPPORT_COMPANY` (`F1Lab`)
  constant (§3);
- `prompts/transcription.js` — OpenAI speech-to-text Russian support-call hint (§3);
- `prompts/ticketCategory.js` — category-classification prompt builder, `({ title,
  description, categories }) → { system, user }` (§4);
- `prompts/ticketTerms.js` — the ticket's conceptual apparatus (§5);
- `prompts/termReference.js` — reference on one concept (§5).

---

## 1. Provider preferences

### Data — `backend/models/preferences.js`
Singleton `Preferences` doc gained an `ai` sub-document:
```
ai: {
  isActive: Boolean,
  provider: "openai" | "anthropic" | "deepseek" | "yandexai" | "local",
  openai:    { apiKey: String, model: String (default "gpt-4o") },
  anthropic: { apiKey: String, model: String (default "claude-opus-4-8") },
  deepseek:  { apiKey: String, model: String (default "deepseek-chat") },
  yandexai:  { apiKey: String, folderId: String, model: String (default "") },
  local:     { baseUrl: String, apiKey: String, model: String },
  features: {                // per-feature switches, default true
    category: Boolean, title: Boolean, guide: Boolean,
    terms: Boolean, feedback: Boolean,
  },
  speechToText: {
    isActive: Boolean,       // the «Расшифровка аудио» feature
    callSummary: Boolean,    // «Описание из записи звонка», default true
    provider: "openai" | "yandex" | "local" (default "openai"),
    useProviderCredentials: Boolean,
    apiKey: String,                                   // OpenAI key
    model: String (default "gpt-4o-transcribe-diarize"), // OpenAI model
    yandex: {
      apiKey: String,
      folderId: String,
      model: String (default "general"),
    },
    local: { baseUrl: String, apiKey: String, model: String },
    health: channelHealth(),
  },
  health: channelHealth(),
}
```
- **Feature switches (2026-09-14).** `ai.isActive` is only the connection to the
  model; what the model does is switched feature by feature in Настройки → ИИ →
  «Функции». `services/ai/features.js#resolveAiFeatures` is the single place
  that combines them: every feature requires `ai.isActive` (transcription and
  the call summary included — before this they ignored it), and a missing
  feature flag means **on**, so older installs lose nothing. `/api/me` sends
  the resolved booleans as `prefs.ai.features`; components read one boolean
  and never repeat the condition.

  | Feature | Flag | Backend | Frontend |
  |---|---|---|---|
  | Подбор категории | `features.category` | ticket create and email intake skip the pass, no `pending` status | — |
  | Тема заявки по описанию | `features.title` | `detectTicketCategory(id, { category })` writes only the title when category is off (title-only prompt) | — |
  | Руководство ИИ | `features.guide` | `aiFeatureIsActive("guide")` on `ai-guide/generate` | guide section + rail item |
  | Понятия в заявке | `features.terms` | gate on `ai-terms/*`; `aiTerms` stripped for clients and for staff without `ai.use` | terms row + underlining, by `AI_ACCESS` |
  | Расшифровка аудио | `speechToText.isActive` | gate on the manual route; email intake skips; `getSpeechToTextConfig` checks the master | «Распознать» |
  | Описание из записи звонка | `speechToText.callSummary` | telephony emails keep their original subject/description | — |
  | Замечания к ИИ | `features.feedback` | gate on `ai-feedback`; `rulesFor` returns no rules | ✦ marks stay as provenance, static, no correction dialog |

  The gate is `middleware/modules.js#aiFeatureIsActive(feature)` (403 with the
  feature's name); the check inside `aiService.generateJson` stays as the last
  line.
- **Who may use them — the `ai.use` permission (2026-09-21).** The switches
  above answer "is the feature on for this install"; `ai.use` («Пользоваться
  функциями ИИ», staff audience, own dictionary group `ai`) answers "may this
  person use it". Every user-triggered AI route carries
  `canPerformTickets, canUseAi, aiFeatureIsActive(...)` — the guide, the three
  `ai-terms/*` routes, `ai-feedback` and manual transcription. Before it the
  tools came with `ticket.perform`, so an outside performer
  (`contractor-no-works`) got the guide built on our knowledge base. Without the
  permission `getOne` also drops `aiGuide` and `aiTerms` from the ticket
  payload, the same way it does for clients: data closed by a permission is not
  put into someone else's payload. Background AI — category and title on a new
  ticket, the call summary — runs on behalf of the system and is not governed
  by the permission; existing transcripts stay visible as attachment content.
  The frontend asks one request everywhere: `Ticket/View/ai-access.js#AI_ACCESS`
  (`{ ticket: ["perform"], ai: ["use"] }`).
  Rollout: `scripts/grantAiUse.js` (migration `2026-09-21-grantAiUse`) adds the
  action to every staff role that has `ticket.perform` except outside-performer
  roles (`services/actionMigration.js#receivesAiUse`). It only appends one
  action — unlike `syncRoleCatalogue`, it does not overwrite roles edited in the
  UI — and it must run: a full-access role that lacks a dictionary action stops
  being `isFullAccess`. The rule is deliberately not in `DERIVED`, which
  re-applies on every `migrateActions` run and would hand the permission back to
  a role the owner took it from.
- **API keys are encrypted at rest** (AES-256-GCM, `services/crypto/secretBox.js`,
  storage format `v1:<iv>:<tag>:<ciphertext>`). Every consumer must read them
  through `readStoredSecret` (`helpers/preferencesSecrets.js`), which also passes
  through values saved before encryption was introduced. Skipping it sends the
  ciphertext as the credential and the provider answers 401 — this was a live
  regression across every provider until 2026-07-31. Keys never leave the server:
  `maskSecrets` blanks them on both read and save and adds a `<field>IsSet` flag;
  an empty field on save means "keep the stored one".
- **One Yandex provider.** Foundation Models were renamed to AI Studio: one host,
  one catalogue, one auth scheme. The former `yandexgpt` provider (native
  `foundationModels/v1/completion` + a hardcoded three-model list) is gone;
  `scripts/migrateAiProvider.js` moves an existing config onto `yandexai`.
- **One provider for every self-hosted server.** Ollama (:11434), LM Studio
  (:1234), vLLM, llama.cpp and LocalAI all speak the same OpenAI-compatible
  `/v1`, so `local` differs from them only by `baseUrl` — a provider per product
  would be the same form with different captions. `buildLocalBaseUrl`
  (`aiService.js`) accepts `host:port`, a trailing slash and an explicit `/v1`,
  and only appends the default path when there is none (behind a reverse proxy
  the address can be `http://host/openai/v1`). Local calls carry a 4-minute
  timeout — a wrong address inside a closed network does not refuse the
  connection, it hangs silently, and it would outlive the AI-guide `pending` TTL.
  The `Authorization` header is omitted when the key is empty: local servers do
  not ask for one and some reject an empty header. `response_format:
  json_object` is sent first and retried without it on a 400, because small
  models need JSON mode the most while some llama.cpp builds reject the field.
  Images are not sent to local models — vision builds are the exception there.
- **Speech recognition has the same `local` option**: faster-whisper-server,
  speaches, LocalAI and vLLM expose an OpenAI-compatible
  `/v1/audio/transcriptions`, so `transcribeWithOpenai` serves them with a
  different endpoint. Ollama is deliberately absent — it does not transcribe
  audio. The OpenAI-model-name guard (`isOpenaiSpeechModel`) applies to the
  OpenAI provider only; local servers name models their own way.
- **`speechToText.useProviderCredentials`** takes the key (and address) from the
  chat provider when the pair actually shares anything: OpenAI↔OpenAI (one key),
  Yandex SpeechKit↔AI Studio (one Cloud key and folder), local↔local (one
  address). Other pairs have nothing in common and the switch is inert — both
  `canShareCredentials` (backend) and the settings form gate on the same map.
  The **model is always the channel's own**: chat and transcription catalogues do
  not intersect. `resolveSpeechConfig` is the single place that resolves this and
  is used by the transcription path, the check endpoint, the model catalogue and
  the save invariant alike.
- `yandexai.model` holds the catalogue path **without** the folder
  (`deepseek-v4-flash`, `yandexgpt-lite/rc`) so that changing the folder ID does
  not invalidate the model. `buildYandexModelUri` in `aiService.js` also accepts a
  whole `gpt://…` URI pasted from the console.
- `health` groups (one per outbound channel — chat provider and speech
  recognition) use the same `channelHealth()` shape as the mail channels and are
  written by `services/ai/health.js`: real calls record success/failure, the check
  buttons record success only. The settings form never sends `health`, and
  `update` merges it back so a section save cannot wipe the status line.

### Backend
- `controllers/preferences.js`
  - `update` — `ai` is wired through the destructure + create + update branches.
  - `getInitial` — returns `ai: { isActive, speechToText: { isActive } }` so the
    client can gate AI guide + speech controls.
  - `getAiModels` — `POST /api/preferences/ai-models { provider, apiKey, feature,
    folderId }`. Calls the provider's list-models endpoint (OpenAI, Anthropic and
    DeepSeek `GET /v1/models`; Yandex AI Studio `GET
    https://llm.api.cloud.yandex.net/v1/models` with `Api-Key` + `x-folder-id`).
    Normal chat models are filtered to `gpt*`/`o\d`/`chatgpt*`;
    `feature:"speechToText"` with `provider:"openai"` filters to speech-capable
    models (`gpt-4o-transcribe*`, `gpt-4o-mini-transcribe*`, `whisper-1`);
    `provider:"yandex"` short-circuits and returns the static `general` model
    (SpeechKit has no catalogue endpoint); `provider:"local"` reads
    `GET {baseUrl}/models` and drops ids matching `/embed/i` (Ollama lists
    embedding models next to generative ones). Stored fallbacks for a speech
    request are taken from the **requested** provider's group, not the saved one
    — the form may have just switched it, and a local server must not receive an
    OpenAI key. The Yandex catalogue answers with full
    URIs mixing generative models, embeddings (`emb://`) and realtime speech
    models — only `gpt://` entries minus `speech-realtime-*` reach the chat
    dropdown, stripped of the folder. Falls back to the saved key and folder if
    none are passed. Admin-only.
  - `checkAi` / `checkSpeechToText` — outbound probes for the settings buttons.
    Both merge the unsaved draft over the whole stored `ai` group (`mergeAiDraft`
    → `mergeWithStored` per provider), so an empty key field means "use the saved
    one"; the speech check needs the chat provider's block too, because the
    credentials may come from there. Both answer the mail-check contract
    `{ ok, state, hint }` with the phrase built by
    `services/aiErrors.describeAiError`. The local speech probe is the model
    catalogue — no need to push a file through.
  - `findAiInvariant` — an enabled channel must be configured whole; otherwise
    `update` answers 422 with a human sentence (mirrors `findMailInvariant`).
- `routes/internal/preferences.js` — `POST /preferences/ai-models`,
  `POST /preferences/ai/check`, `POST /preferences/ai/speech-check`
  (`isAuth, canManageSettings, checkLimiter` — 20 requests / 5 min, shared with
  the mail checks; `settings.manage` is the single right for the whole settings
  page). Other AI settings ride the existing `POST /preferences`.
- `services/aiService.js`
  - `generateJson` — the single provider-agnostic entry point. Reads the config,
    decrypts the key, dispatches by provider, parses the JSON answer (stripping
    `<think>…</think>` from reasoning models) and records channel health.
  - `checkProvider` — a minimal real generation asking for `{"ok": true}`. Connect
    and key alone are not proof: a wrong model id or an uncooperative answer
    format only shows up in a real round trip. The word "JSON" stays in the prompt
    because OpenAI rejects `response_format: json_object` without it.
- `services/speechToTextService.js`
  - `checkSpeechToText` — OpenAI: `GET /v1/models` with the speech key; Yandex:
    0.2 s of generated LPCM silence to the **synchronous** `speech/v1/stt:recognize`.
    The production path (async v3 with a file) cannot serve as a settings probe.

### Frontend
- `components/Preferences/Ai.jsx` — the whole «Искусственный интеллект» section:
  it owns the `ai` group and posts it in one payload. Model dropdowns are filled
  on demand from `POST /preferences/ai-models`; the two check buttons post the
  current draft and render the answer through `channel-health.js` into
  `app/HealthRow`. Layout rules live in `docs/ux-ui-guide.md` («Панели настроек»),
  not here.
- `pages/Preferences.jsx` — registers the section; the page action persists it.

---

## 2. Ticket solution guide

### Data — `backend/models/ticket.js` (+ `types/ticket.ts`)
`ticketSchema.aiGuide` (NOT in the shared `ticketDefaultFieldsSchema`):
```
aiGuide: {
  status: "idle" | "pending" | "ready" | "error",
  kind:   "solution" | "questions",
  summary: String,
  items:  [{ text: String, done: Boolean }],   // checkable in the UI
  sources: [{ _id: ObjectId(KnowledgeNote), title: String, type: String }], // KB notes used
  provider, model: String,
  error: String,
  generatedAt: Date,
  generatedFromCommentCount: Number,
}
```

### Services — `backend/services/`
- **`aiService.js`** — `generateJson({ system, user, images, maxTokens, requireActive })`:
  - reads the singleton `Preferences`; throws `AppError` if no provider key, and
    (unless `requireActive:false`) if `ai.isActive` is off;
  - OpenAI → `POST /v1/chat/completions` with `response_format:{type:"json_object"}`,
    **neither `temperature` nor an output cap**: GPT‑5/o‑series reject a custom
    `temperature` with a 400, and even a valid `max_completion_tokens` is spent on
    reasoning budget there, which ends in a 400 or an empty answer; Anthropic →
    `POST /v1/messages`, `max_tokens` (`maxTokens` or 1500),
    `anthropic-version: 2023-06-01`;
  - on a non-OK response the thrown error message **includes the provider's
    response body**, so the real cause is visible in logs;
  - `images` become provider-specific blocks (OpenAI `image_url`, Anthropic
    `image`/base64);
  - `parseJsonResponse` strips `<think>…</think>` (reasoning models put braces in
    there and would derail the fallback), then ```` ```json ```` fences, then
    extracts the outer braces before `JSON.parse`.
- **`attachmentExtractor.js`**:
  - `collectAttachments(ticket)` — ticket + all comment attachments, de-duped.
  - `extractAttachments(...)` →
    - **images** (`png`/`jpeg`/`jpg`, `jpg`→`jpeg`) base64-encoded — **cap 5**,
      skip files **> 5 MB**;
    - **documents** → text: **PDF** (`pdf-parse` v2 `PDFParse` class), **DOCX**
      (`mammoth`), **XLSX** (`xlsx` → CSV/sheet), **TXT**; each capped ~8k chars.
    - per-file try/catch — unreadable/unsupported files are logged & skipped.
  - Files are read from `uploads/<name>` (relative to backend cwd, matching the
    rest of the codebase).
- **`ticketAiGuide.js`** — `generateTicketAiGuide(ticketId)`:
  - loads ticket with `categoryId`, `applicantId`, `comments`(+`createdBy`,
    `attachments`); fetches company `alias`/`fullTitle`;
  - `buildUserContent` — title, HTML-stripped description, category, priority/
    impact/urgency, source, custom fields, applicant, company, last ~20 comments;
  - appends extracted document text and an image-count note to the prompt; the
    system prompt itself is imported from `prompts/ticketGuide.js`;
  - **feeds past closed tickets of the SAME company** (`collectPastTickets`): up
    to 5, same category first then by recency, each with its works' descriptions
    (what was actually done) and the closing comment **only when it is ≥ 100
    chars** — 390 of 400 closing comments are the «Работы по заявке выполнены»
    boilerplate and would only burn tokens. This is the institutional memory that
    stops the model from asking what a previous ticket already answered;
  - **pulls in relevant knowledge-base notes** via
    `services/knowledgeBaseContext.js` `collectRelevantNotes({ companyId, categoryId,
    applicantId, title, text })`. Company/category/applicant bindings pick the
    **candidates** (same matching as the ticket "База знаний" section,
    `Ticket/View/KnowledgeSection.jsx`); the ticket's own words then decide which
    of them are actually sent, in three tiers: notes touched by words of the
    **title**, else by words of the **description**, else — nothing matched —
    the old binding order. Untouched notes are dropped rather than padded in: a
    "priority source" about someone else's topic is worse than no source at all.
    Matching is stem-based (first 5 letters, no morphology), with a stop-list for
    filler words; pure numbers are not words (`21` in a ticket title used to hit a
    subnet mask inside a note), while `1с`/`vpn`/`rdp` are. Top 5, formatted by
    `buildKnowledgeContext` and appended to the prompt as a **priority source**.
    Per-user `canViewNote` is intentionally **not** applied — the guide is a shared
    staff-only artifact. The used notes are persisted on `aiGuide.sources`;
  - calls `generateJson` with images; **text-only fallback** if the vision call
    fails (e.g. non-vision model) so a guide is still produced;
  - persists `aiGuide` via `findByIdAndUpdate`; **never throws** — failures are
    recorded as `status:"error"`.
  - `expireStalePendingGuide` — generation runs inside a live request, so a
    process restart (deploy, nodemon) kills it *without* an exception: the catch
    above never fires and `status` stays `pending` while the ticket card polls it
    forever. `aiGuide.startedAt` gives `pending` a 5-minute lifetime; the ticket
    read path (`controllers/ticket.js` `getOne`) flips an expired one to `error`
    and writes a chronicle line, because the panel's error text points there. A
    generation that is still alive simply overwrites the verdict with its result.
    `regenerateAiGuide` sets `startedAt` and clears the previous `error` — a stale
    reason used to resurface as the cause of the *next* run.

`backend/package.json` / `tsconfig.json` — added `@/services` and `@/prompts`
module aliases and deps `pdf-parse`, `mammoth`, `xlsx`.

### Controller / routes — `backend/controllers/ticket.js`, `routes/internal/ticket.js`
- `add` — does **not** touch `aiGuide` (stays `idle`) and does **not** fire
  `generateTicketAiGuide`: guide generation is manual-only at the current stage
  (the on-creation auto-trigger was removed 2026-07-14). Only category detection
  runs in the background after the 201.
- `getOne` — `delete doc.aiGuide` when `isEndUser` or without `ai.use`
  (internal aid only).
- `regenerateAiGuide` — `POST /tickets/ai-guide/generate { _id }`, **synchronous**,
  returns the refreshed guide. Route: `isAuth, canPerformTickets, canUseAi,
  byBodyId` — the AI tools need `ticket.perform` and `ai.use`, and `byBodyId`
  additionally checks the caller's relation to that ticket.
- `toggleAiGuideItem` / `POST /tickets/ai-guide/toggle-item` — **removed 2026-07-30**
  together with the per-item checkboxes (10 ticks across ~980 items in 99 guides).
  The `done` field stays in the schema; nothing writes it.
- `detectCategory` / `POST /tickets/ai-category/detect` — **removed 2026-07-30**.
  Category detection is background-only, on ticket creation and on incoming mail.

### Frontend
- `components/Ticket/View/AiGuideSection.jsx` — the whole «Руководство ИИ» section
  (eyebrow + panel), replacing `AiAssistant` / `AiGuide` / `AiCategory` / `AiSection`
  and the `.ai-*` CSS block in `index.css`:
  - `idle` / `pending` / `error` are **one line each**; `pending` polls
    `GET /api/tickets/:num` every 4 s until the status changes;
  - `ready` → summary, then the items as a **read-only numbered list** (no
    checkboxes, no progress ring), collapsed to 5 with «Показать все N»;
  - `questions` (3 of 4 guides) → amber «Не хватает данных» line, action
    **«Спросить заявителя»** puts the questions as a draft into the chronicle's
    comment box (`store/view-ticket` → `pushCommentDraft`, consumed and cleared by
    `Chronicle`), plus a per-item `+` that appends a single question. Nothing is
    sent automatically;
  - `solution` → the checklist action, named by state: **«Составить чек-лист»**
    when the ticket has none, **«Дополнить чек-лист»** when it already has one.
    Steps are appended via the same `POST /tickets/:num/update-checklist`
    (existing ticks survive — the server matches them by `_id`) with
    `source: "ai"`, which makes the ticket-log entry read «Чек-лист составлен
    ИИ» instead of a plain edit. This is the cheapest way a checklist ever gets
    created: not a single invented item, the guide steps are already written;
  - `aiGuide.sources` → compact rows (type icon + title) opening
    `/knowledge-base/:id` in a new tab;
  - footer: provider · model · when generated · how many comments were taken into
    account.
- `pages/Ticket/View.jsx` — renders `<AiGuideSection />` **third, right after
  «Детали»** (since 2026-07-31), gated by `!isEndUser && ai?.isActive`; the rail
  entry is «Руководство ИИ» and follows the same order. It answers "what to do",
  which is what a ticket is opened for — but not before the facts: company,
  requester and assignee are facts, a guide is a proposal.
- `store/prefs.js` — carries the `ai.isActive` flag from `getInitial`.

---

## 3. Speech recognition / call summary

### Data — `backend/models/ticket.js` (+ `types/_shared.ts`)
Ticket attachments now support a `speechToText` sub-document:
```
speechToText: {
  status: "idle" | "pending" | "ready" | "error",
  text: String,       // flat transcript of `segments` ("Name: line", blank-line separated)
  summary: String,    // Russian call summary; also becomes the ticket description
  segments: [{
    speaker: String,
    text: String,
    start: Number,
    end: Number,
  }],
  model: String,
  error: String,
  generatedAt: Date,
}
```
`text` and `summary` are two different artefacts and must never hold the same
string: `text` is what was said, `summary` is what it means (and what the email
trigger copies into `ticket.description`). Until 2026-07-30 the service built
`text` as `summary || transcript`, so on the happy path both fields held the
identical summary and the transcript survived only inside `segments`.

Attachment writes were normalized to include both `mimetype` and `mimeType` plus
`originalName`/`size` where the upload source provides them. This matters because
older ticket code used `mimetype`, while later attachment upload code used
`mimeType`.

### Services — `backend/services/speechToTextService.js`
- `isAudioAttachment(attachment)` recognizes supported audio/video-audio uploads
  by extension or MIME type: `mp3`, `mp4`, `mpeg`, `mpga`, `m4a`, `wav`, `webm`,
  `ogg`, `oga`, `opus` and matching `audio/*` / selected `video/*` MIME types.
- `transcribeAttachment(attachment)` reads `Preferences.ai.speechToText`,
  resolves the **provider** (`openai` | `yandex`) via `getSpeechToTextConfig`
  (throws if disabled or the provider's key is missing), then dispatches to a
  provider-specific recognizer that returns normalized `segments`. The summary
  pass, name-correction, and assembly are shared across providers.
- **OpenAI path** (`transcribeWithOpenai`):
  - reads `uploads/<attachment.name>` and enforces OpenAI's **25 MB** audio cap;
  - sends multipart `POST /v1/audio/transcriptions` using global `fetch`,
    `FormData`, and `Blob`;
  - for `gpt-4o-transcribe-diarize` uses `response_format:"diarized_json"`,
    `chunking_strategy:"auto"`, and `language:"ru"`;
  - for non-diarize speech models uses `response_format:"json"`, `language:"ru"`,
    and a Russian support-call prompt (`prompts/transcription.js`).
- **Yandex SpeechKit path** (`transcribeWithYandex`) — STT **v3 async REST**, no
  SDK, matching the global-`fetch` principle:
  - maps the file extension to a Yandex container (`mp3`→MP3, `wav`→WAV,
    `ogg`/`oga`/`opus`→OGG_OPUS); other formats throw a clear error. **100 MB**
    cap (audio is sent inline as base64 `content`, no Object Storage);
  - `POST /stt/v3/recognizeFileAsync` with `audioProcessingType:"FULL_DATA"`,
    `languageRestriction` `ru-RU`, text normalization, and
    `speakerLabeling:"SPEAKER_LABELING_ENABLED"` for diarization;
    auth via `Authorization: Api-Key <key>` (+ optional `x-folder-id`);
  - polls `GET /operations/{id}` every 3 s (up to ~6 min) until `done`;
  - fetches `GET /stt/v3/getRecognition?operation_id={id}` (NDJSON stream) and
    parses results into `{speaker,text,start,end}` segments, taking the speaker
    from word/channel tags. Yandex emits both a raw `final` and a normalized
    `finalRefinement` per utterance; `parseYandexResults` uses **only the
    refinements when any exist** (else the raw finals), so the same phrase isn't
    captured twice (which previously showed as duplicated dialog text).
    Within one utterance only **`alternatives[0]`** is used: alternatives are
    competing hypotheses of the *same* phrase, so joining them glued the phrase
    to itself. It is also the alternative the speaker tag and timestamps are
    read from, so text and metadata stay consistent.
- Both paths then:
  - normalize diarization to **at most two participants**, because the current
    business assumption is that calls always contain exactly two people;
  - make a second AI call (`summarizeDialog`) that returns a **cleaned dialog**, a
    **plain-prose** Russian description (reads like a ticket description — no
    section headings or bullet lists) **and a short ticket title**. This always
    runs on the **main configured AI provider** from preferences via
    `aiService.generateJson` — for **both** ASR providers (OpenAI and Yandex) — so
    the summary uses the strong global model (e.g. gpt-4o / Claude Opus) rather than
    a cheap fixed model. It passes `requireActive:false` (the speech feature has its
    own toggle, so the AI-guide master switch `ai.isActive` is **not** required —
    only a configured provider key) and `maxTokens:4096` (the dialog+summary JSON is
    large; Anthropic's 1500 default would truncate it → invalid JSON). On
    failure/empty the raw dialog is shown without a summary and the reason is logged
    at **error** level ("Speech summary/dialog generation failed");
  - `normalizeDialog` accepts the model's `dialog` as either `[{speaker,text}]`
    objects **or** `["Speaker: text"]` strings, so a validly-returned dialog isn't
    dropped on a shape mismatch (which would leave the raw ASR text on screen);
  - **dialog cleanup + name correction** (`buildSummaryPrompt`, imported from
    `prompts/callSummary.js`; the service passes it already-`compactSegments`-ed
    segments): the prompt has the model (a) fix the support-side greeting to our
    company name **`F1Lab`** (constant `SUPPORT_COMPANY`, also in that file) — so
    "техподдержка Фатима" → "техподдержка F1Lab";
    (b) label the operator's turns with the real employee name and refer to them by
    name in the summary (not "оператор"); (c) remove duplicated text and filler
    words (угу/ага/мм…); (d) capture equipment identifiers (PC/printer/host/serial/
    IP/ticket numbers) in the summary; (e) drop uninformative pleasantries
    ("оператор принял заявку и попрощался"). The returned cleaned `dialog`
    **replaces** the raw segments shown in "Итог разговора"; on failure/empty the
    raw segments are kept;
  - **known context** comes from `callerIdentityService.buildKnownCaller(ticket,
    prefs)` → `{ applicantName, companyName, operatorName }`: the verified caller
    (a **real client only** — excluding the default account by id and any
    `isServiceAccount`/`isCloudTelephony` account by flag, so an unknown caller is
    never replaced with a service account), the ticket company alias, and the
    operator name parsed from the **"С кем говорил:"** field of the email body
    (text or HTML). Names are corrected toward these values;
  - returns `{ text, summary, title, segments, model, generatedAt, summaryError,
    recognized }`. `text` is the **flat transcript** — `formatSegments(segments)`, i.e.
    the cleaned dialog when the summary pass returned one, otherwise the raw ASR turns —
    and never the summary; `title` is consumed by the email auto-trigger and ignored by
    the manual path; `recognized` is `true` only when ASR produced real non-empty speech
    (not just an empty fallback segment), and the email auto-trigger uses it to gate the
    ticket title/description overwrite (see §3 Email auto-trigger);
  - `recognized:false` (silent or unrecognizable audio) now yields an **empty `text` and
    therefore the "Speech recognition returned an empty result" error**, i.e. attachment
    `status:"error"`, instead of the previous `ready` with a summary hallucinated from an
    empty transcript.

### Controller / routes — `backend/controllers/ticket.js`, `routes/internal/ticket.js`
- `POST /tickets/:ticketNum/attachments/speech-to-text` (`isAuth,
  canPerformTickets, canUseAi, byNum`) accepts `{ attachmentName }`.
- The controller sets the attachment `speechToText.status` to `pending`, calls
  `transcribeAttachment`, then persists `ready` with summary/segments/model/time
  or `error` with the provider/service message.
- `pending` and `error` writes replace the whole sub-document, so they spread
  `carryOverSpeechResult(previous)` (exported by the service) first: re-running
  recognition on an already-`ready` attachment must not wipe the previous
  `text`/`summary`/`segments`/`model`/`generatedAt` — on failure they would be
  gone for good. The email path does the same, taking `previous` from the
  re-fetched ticket rather than from the pre-`pending` snapshot.
- Manual recognition is synchronous from the frontend perspective: the request
  returns when recognition + summary generation is complete.

### Email auto-trigger — `backend/middleware/emailHandling.js`
- When a new email becomes a **new ticket**, saved attachments are checked with
  `isAudioAttachment`.
- If `prefs.ai.speechToText.isActive` and at least one ticket attachment is audio,
  `transcribeTicketAudioAttachments(ticket._id)` is started in the background
  after `ticket.save()`.
- The email processor does not await OpenAI before continuing IMAP processing.
  Each audio attachment is saved as `pending`, then `ready`/`error`.
- **Title/description overwrite needs both: a telephony sender AND a successful
  recognition.** On the **first** audio attachment that yields a summary, the ticket's
  `description` is overwritten with the call summary and `title` with the generated
  title — **but only when both hold**: (1) the ticket came from a **cloud-telephony
  account**, determined by looking up the sender (`ticket.realSender` email) and
  checking `isCloudTelephony` (`callerIdentityService.isCloudTelephonySender`), **and**
  (2) **recognition genuinely succeeded** — `transcribeAttachment` returned
  `recognized:true` (ASR produced real non-empty speech, not just an empty fallback
  segment), a non-empty `summary`, and no `summaryError`. The **email subject is no
  longer checked**: the telephony provider (Mango) sends recordings with varying subjects
  ("Запись разговора … +<номер> <имя>", "Входящий звонок", …), so keying the overwrite on
  the literal "Входящий звонок" string silently skipped real recordings (the dialog and
  summary were generated but never written back to the ticket, and the category was then
  detected from the raw provider email). The `recognized` guard also keeps an
  empty/garbled call — or a hallucinated summary on empty ASR input — from wiping the
  original description. For ordinary emails that happen to carry audio — e.g. from
  rank-and-file users like `fedoseeva@`/`churinova@`, where `isCloudTelephonySender` is
  `false` — the recording is still transcribed and the dialog/summary shown, but the
  email's own subject/body are left untouched (the `isTelephonyTicket` check alone
  protects them). Separately and **unchanged**, the email handler still normalizes the
  **creation-time** ticket title to `"Входящий звонок"` only when the subject already
  contains it **and** there is audio, so phone-number identification alone (a number
  found in a forwarded thread, signature, or an empty-body email) never rewrites the
  subject; `extractCallerPhone` is still used to identify the applicant/company. When the
  overwrite does apply: the original email body is preserved in `htmlDescription` (still
  reachable via "Просмотр оригинала"); if it was empty, the original `description` is
  moved there first. Newlines → `<br>` since both fields render as HTML.
- This currently applies only to **new email-created tickets**, not email replies
  that become comments.
- **Ticket-level status** `ticket.aiSpeech.status` tracks the background job for the
  UI: set to `pending` at creation (when speech is on and an attachment is audio),
  flipped to `processed` once the description/title are updated, and finalized after
  the loop to `processed` (any attachment transcribed) or `error` (none). Returned
  by `getOne` and `getAllOpened`; drives the live badge (see Frontend).
- **`pending` expires.** The transcription runs as a detached background task, so a
  process restart kills it *without* rejecting the promise — the `.catch` guard in
  `emailHandling.js` never fires and the status stays `pending`. That costs more
  here than anywhere else: `createTicketNotifications` filters on
  `aiSpeech.status !== "pending"`, so a stuck ticket is one **nobody is ever told
  about**. Both levels now carry a `startedAt` and a 15-minute lifetime (long
  enough for Yandex's ~6-minute async polling plus the AI summary):
  - the notification query releases an expired wait inline (`$or` on `startedAt`,
    no extra collection scan) and flips the ticket to `error` with a chronicle
    line;
  - `expireStalePendingSpeech` does the same for a stuck
    `attachment.speechToText` on the ticket read path, next to
    `expireStalePendingGuide` — the card polls that response.
  A transcription that is still alive simply overwrites the verdict with its
  result.

### Caller identification — `backend/services/callerIdentityService.js`
For telephony emails the applicant + company are resolved **by phone number only**
(the service is imported by `emailHandling.js`): `extractCallerPhone` pulls the
caller's number from the email subject or body (explicit `Кто звонил:` marker
first, then any phone-like token), normalizes it to E.164 via the `phone` lib, and
`findApplicantByPhone`/`findCompanyByPhone` match it against `user.phone` /
`company.phones` using a **digit-suffix regex** (last 10 digits, separator
tolerant). A user match yields the user *and their linked company*. Gated by the
existing `identifyApplicant`/`identifyCompany`/`checkPhoneNumber` prefs; this
replaces the old fragile `email.name.split(" ")[4]` extraction.

**No name-based guessing.** If the number is not in the database, the ticket keeps
the **default applicant/company from preferences** (the prior behavior). An earlier
fuzzy name-matching fallback was removed: ASR-garbled names produced confident but
wrong matches (assigning unrelated clients/companies), which risked client-facing
confusion and conflicts.

### Frontend
Entry point is `components/Ticket/View/AttachmentStrip.jsx` — since 2026-07-31
attachments live as a strip inside the description panel, not as their own
section (`UI/AttachmentPreview.jsx` and `Ticket/View/Attachments*.jsx` are gone;
the file chip is shared with the chronicle via `View/AttachmentChip.jsx`, type
detection in `View/attachment-utils.js`).
- Audio is the one attachment kind kept expanded: a native `<audio>` row plus a
  **«Распознать»** / **«Расшифровка»** button. Recognition is gated by
  `!ticket.isArchived`, `can({ ticket: ["perform"] })` and
  `ai.speechToText.isActive`; the call updates the `view-ticket` store with the
  returned attachments.
- Per-attachment state is a meta line next to the player: «ИИ распознаёт
  запись…» / «не удалось распознать». The card poll still watches
  `aiSpeech.status`.
- `store/prefs.js` carries `ai.speechToText.isActive` from `getInitial`.
- `UI/AiSpeechBadge.jsx` — **removed with the ticket-card redesign (2026-07-30)**,
  and with it the AI badges in list rows: a background job nobody is waiting on
  does not deserve a marker in a list of 47 tickets. What replaced them:
  - **Ticket card** (`pages/Ticket/View.jsx`): the recognition result is a
    ticket write, so the live-update pulse reports this ticket changed and the
    card revalidates its loader — the refreshed title/description appear by
    themselves (`docs/live-updates.md`). Paused while a form sheet or the
    checklist editor is open, so a server answer never overwrites unfinished
    input; the change applies right after.
  - **Ticket list** (`pages/Ticket/List.jsx`): on the `tickets` topic,
    `store.silentRefresh` (`store/lists/tickets.js`) refreshes rows in place —
    it updates `originalList`/`filteredList` atomically **without** touching
    `isLoading`/`isSorting`, so `ListWrapper` never swaps the list for a
    `<Spinner>`. Paused while the selection mode is on.

---

## 4. AI ticket category detection

Picks the best-matching `TicketCategory` for a new ticket from its title/description
and the categories' descriptions, filling `categoryId` **only when it is empty** (a
manually chosen category is never overwritten). Gated by the same master switch
`ai.isActive` as the solution guide.

**Status field** — `ticketSchema.aiCategory.status` (`pending` | `processed` | `error`,
mirroring `aiSpeech`) tracks the background job for the UI. It is set to `pending` at
creation (or by the service when it starts), flipped to `processed` once detection is
done (whether or not a category was assigned) and `error` on failure. Returned by
`getOne` and the opened-list projection; drives a live badge (see Frontend below).

### Prompt — `backend/prompts/ticketCategory.js`
Builder `({ title, description, categories }) → { system, user }`, where `categories`
is `[{ id, title, description }]`. The system prompt frames the model as a support-ticket
classifier, tells it to choose **one** category primarily by the category's `description`
(title as a hint), and to return `null` if nothing fits confidently. Output is strict
JSON: `{ "categoryId": "<id from the list>" | null, "reason": "..." }` (`reason` is
log-only). The user message is `JSON.stringify({ ticket: { title, description },
categories })`.

### Service — `backend/services/ticketCategoryService.js`
`detectTicketCategory(ticketId)` (mirrors `ticketAiGuide.js`; **never throws** — errors
are logged):
- loads the ticket (`num title description htmlDescription categoryId`); **returns early
  if `categoryId` is already set**;
- loads `TicketCategory.find({ isActive: true }).select("title description")`; returns if
  there are none;
- strips HTML and truncates the description (local `stripHtml`/`truncate`, ~2k chars;
  category descriptions capped ~600), then calls `aiService.generateJson({ system, user })`
  (default `requireActive: true`, so it respects `ai.isActive`);
- **validates** the returned `categoryId` against the candidate id set; on a valid match
  `Ticket.findByIdAndUpdate(ticketId, { categoryId, "aiCategory.status": "processed" })`,
  otherwise leaves the category empty (status `processed`) and logs at `info`; on any error
  sets status `error`.
- writes **ticket-log** entries (`TicketLog`) for start / end / error via
  `services/aiTicketLog.js` `logAiTicketEvent(ticketId, event, severity)` (system actor
  "ИИ"; `info`/`danger`).

### Triggers
- **Web form** — `controllers/ticket.js` `add`: sets `aiCategory.status = "pending"` at
  creation (when no `categoryId` and `ai.isActive`); after the 201 it runs
  `detectTicketCategory` in the background (the AI guide is **not** auto-generated —
  manual-only, see §2). Never blocks/fails ticket creation.
- **Email (no transcription)** — `middleware/emailHandling.js` new-ticket branch: when the
  ticket will **not** be transcribed and `ai.isActive`, sets `aiCategory.status = "pending"`
  and fires `detectTicketCategory` in the background from the email subject/body.
- **Telephony / transcribe→summary→title** — `transcribeTicketAudioAttachments`: after the
  `aiSpeech.status` finalization (and when `ai.isActive`), awaits `detectTicketCategory` so
  the category is chosen from the **call summary** that replaced the description (when the
  overwrite applied — see Email auto-trigger gate), not the raw telephony-provider email.
  Email replies that become comments are not categorized.
- **Telegram** — the bot is a **separate service** with its own models and no shared code,
  so detection is self-contained in `telegram-bot/services/ticketCategoryService.js` (a
  mirror of the backend prompt + a minimal `axios`-based provider call). On a new ticket
  (`tgBotApi.js` `addTicket`), after save and when `ai.isActive`, it runs detection in the
  background. Requires the `ai` sub-doc on `telegram-bot/models/preferences.js`, a
  `TicketCategory` model, and `aiCategory` on the bot's ticket model. **Keep this file in
  sync with the backend prompt/logic.**

### Speech-recognition ticket logs
The speech flow also writes `TicketLog` start/end/error entries via the same
`logAiTicketEvent` helper — in `controllers/ticket.js` `transcribeAttachment` (manual) and
`middleware/emailHandling.js` `transcribeTicketAudioAttachments` (auto, per attachment).

### Frontend
- `UI/AiCategoryBadge.jsx` — **removed with the ticket-card redesign (2026-07-30)**.
  The state now lives where the value does: the «Категория» row of
  `Ticket/View/Sections.jsx` says «ИИ подбирает категорию…» while
  `aiCategory.status === "pending"` and the category is still empty. The card's
  background poll (`ticketSignature` includes `aiCategory.status`) revalidates when
  it resolves, so the title appears by itself.

---

## 5. Subject reference (ticket terms)

The assistant answers two different questions and the split runs through the whole
design: the **guide** (§2) answers "what to do about this ticket", the
**reference** answers "what is this thing". The first lives exactly one ticket;
the second is reusable, which is why it can flow into the knowledge base and come
back through the normal note matching — without a model call.

### Data — `backend/models/ticket.js`
```
aiTerms: {
  status: "idle" | "pending" | "ready" | "error",
  startedAt, error, generatedAt,
  items: [{
    term: String,
    inText: Boolean,           // встречается в тексте заявки дословно
    reference: {               // пусто, пока справку не открывали
      summary, blocks: [{ title, kind: "text"|"list"|"steps", text, items }],
      links: [{ url, title, host }],   // только прошедшие живую проверку
      provider, model, generatedAt,
    },
  }],
}
```
`inText` is computed in code, never asked of the model: it decides whether the
word gets underlined inside the description or listed under «Ещё в теме», and
that border between the requester's words and the model's guesswork has to be
exact.

### Service — `backend/services/ticketAiTerms.js`
- `analyzeTicketTerms` — one call with `prompts/ticketTerms`; dedupes, caps at 5,
  marks `inText`, never throws (failure lands in `aiTerms.status`). No chronicle
  entry on failure: the analysis is a reader's aid, not an event in the ticket's
  life, and the reason is shown inline next to the terms.
- `buildTermReference` — generates on demand with `prompts/termReference` and
  **returns a stored reference as is**: opening an already-analysed term must be
  a read, not a new generation.
- `verifyDocLinks` — every link is fetched (HEAD, GET on 403/405/501, 6 s
  timeout) and dropped unless it answers < 400. A hallucinated URL is the model's
  most frequent sin, and a dead link in a reference costs more than a missing one.
  There is deliberately **no domain whitelist**: there are as many vendors as
  there are subjects.
- `saveReferenceAsNote` — builds markdown, creates an **unapproved** note bound to
  the ticket's category, and runs `rescanNoteDerived` (extracted to
  `helpers/knowledgeNoteDerived.js`, shared with the knowledge-base controller) so
  the secrets scanner sees it immediately rather than an hour later.
- `expireStalePendingTerms` — the same `pending` lifetime as the guide.

### Feedback that becomes a rule — `models/aiFeedback.js`, `services/aiRules.js`
A mark on AI-written data opens a form with a **mandatory reason** and free text:
a thumbs-down cannot be turned into a rule. The record is written immediately and
shown in the ticket chronicle, but reaches prompts only once an administrator
flips `isActive` in «Настройки → ИИ» — one emotional sentence would otherwise
quietly poison generation for the whole team. Scope always comes from the ticket
(category + company); `rulesFor` appends active rules to the guide, category and
reference prompts alike. The bot mirrors the read side
(`telegram-bot/models/aiFeedback.js`) so category detection behaves the same
wherever a ticket is created.

### API
| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/tickets/ai-terms/analyze` | `ticket.perform` + `ai.use` | extract the ticket's concepts |
| POST | `/api/tickets/ai-terms/reference` | `ticket.perform` + `ai.use` | reference for one concept |
| POST | `/api/tickets/ai-terms/save-note` | `ticket.perform` + `ai.use` + `knowledge.manage` | store it as a note |
| POST | `/api/tickets/ai-feedback` | `ticket.perform` + `ai.use` | record a correction |
| GET/POST | `/api/preferences/ai-rules[/toggle,/delete]` | `settings.manage` | review and enable rules |

### Frontend
`Ticket/View/TicketTerms.jsx` (strip + reference) and `Ticket/View/AiMark.jsx`
(mark + correction form).

Both the term underline and the mark are injected into the description's
**already-sanitized** HTML, because React nodes cannot live inside
`dangerouslySetInnerHTML`: `highlightTerms` is a string replacement over text
chunks only (the injected markup carries the term's **index**, never model text),
and `appendAiMark` uses `DOMParser` to place the mark at the end of the last
line — skipping void tags (an itemized call summary is `text<br>text`, and a mark
inside `<br>` is lost on serialization) and descending into the last `<li>` of a
list. The mark is the app's own AI icon (`RiSparkling2Line`) rebuilt as inline
`svg` with the same path, so it is identical to the React one used on the
category row. One delegated handler serves both, resolving the target with
`closest` — a click can land on the `<path>` inside the icon. The correction form
opens in a **dialog**, not in place: pushing apart the description someone is
reading is the worst thing to do to their attention. Layout rules are in
`docs/ux-ui-guide.md` («Что сделал ИИ, а что человек»).

---

## API summary

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/preferences/ai-models` | `settings.manage` | list provider models |
| POST | `/api/preferences/ai/check` | `settings.manage` | probe the chat provider (real generation) |
| POST | `/api/preferences/ai/speech-check` | `settings.manage` | probe the speech recognition channel |
| POST | `/api/tickets/ai-guide/generate` | `ticket.perform` + access to the ticket | (re)generate guide for a ticket |
| POST | `/api/tickets/:ticketNum/attachments/speech-to-text` | `ticket.perform` + access to the ticket | summarize an audio attachment |
| POST | `/api/tickets/ai-terms/analyze` | `ticket.perform` | extract the ticket's concepts |
| POST | `/api/tickets/ai-terms/reference` | `ticket.perform` | reference for one concept |
| POST | `/api/tickets/ai-terms/save-note` | `ticket.perform` + `knowledge.manage` | store a reference as a note |
| POST | `/api/tickets/ai-feedback` | `ticket.perform` | record a correction to AI-written data |
| GET | `/api/preferences/ai-rules` | `settings.manage` | review corrections |
| POST | `/api/preferences/ai-rules/toggle` | `settings.manage` | let a correction reach the prompts |
| POST | `/api/preferences/ai-rules/delete` | `settings.manage` | drop a correction |

(Provider settings persist via the existing `POST /api/preferences`; AI guide and
speech results are returned inside the existing `GET /api/tickets/:num`.)

---

## Known limitations / optimization opportunities

Operational / correctness:
- **Container deps**: `pdf-parse`/`mammoth`/`xlsx` were added to `package.json` but
  the Docker image must be rebuilt (or `pnpm install` run in-container) — the
  container ships its own `node_modules`.
- ~~Fire-and-forget generation leaves `status:"pending"` forever~~ — closed
  2026-07-31 for the AI guide, ticket-level speech and attachment-level speech:
  each carries a `startedAt` and expires (see the respective sections).
  `aiCategory.status` still has no lifetime, but nothing gates on it — a stuck
  value only means the category was not auto-filled.
- **No concurrency guard / rate limiting** on generation — a burst of new tickets
  or email tickets with audio fires N parallel provider calls.
- **Email auto-transcription is background-only**: email-created tickets can show
  speech `pending`/`error` after the email itself has already been marked seen.

Cost / quality:
- **No prompt caching** (Anthropic). Regeneration re-sends the full context each
  time; caching the system prompt + static context would cut cost.
- **`max_tokens` defaults to 1500** but is now overridable via
  `generateJson({ maxTokens })` (the speech summary passes 4096 so the full cleaned
  dialog + summary JSON isn't truncated). A *very* long call could still exceed
  4096 (→ caught, raw dialog shown without summary); splitting summary and dialog
  into two calls would remove that ceiling.
- **Models hardcoded as defaults** (`gpt-4o`, `claude-opus-4-8`,
  `gpt-4o-transcribe-diarize`).
- ~~Plaintext API key storage~~ — closed 2026-07-31: keys are encrypted at rest
  and read through `readStoredSecret` (see above).
- **Speech recognition quality in Russian is variable**; the raw dialog is shown
  for reference while the AI summary (not the verbatim transcript) is what feeds
  the email ticket's description/title.
- **Yandex SpeechKit path is untested against the live API** — the v3 async REST
  flow (request/operation poll/getRecognition parsing, speaker-tag extraction) is
  implemented from the docs and may need field-name/format tweaks. It also blocks
  on synchronous polling (up to ~6 min) and accepts only MP3/WAV/OGG-OPUS inline
  (100 MB), unlike the OpenAI path which also takes mp4/m4a/webm.
- **Diarize model cannot use prompts**; quality improvements are limited to
  `language:"ru"`, chunking, two-speaker normalization, and the post-recognition
  summary pass.

Coverage:
- **Audio is summarized only for ticket attachments** via the manual button, and
  automatically only for new email-created tickets. Audio attachments on comments
  are not auto-summarized yet.
- **The guide is the only source of AI-made checklists.** Steps of an existing
  guide can be turned into a ticket checklist, but there is no «generate a
  checklist from scratch» call — neither in the ticket checklist editor nor in
  the checklist-template form. Coverage is therefore capped by guide coverage:
  99 ready guides out of 3387 tickets over the last year (2.9 %), plus 374
  `idle` and 27 `error`.
- **`pptx` and `rtf` not extracted** (accepted as uploads but skipped); would need
  another lib.
- **No OCR** — scanned/image-only PDFs yield little/no text (images still go via
  vision if they're image attachments, but not PDF pages).
- **Vision requires a vision-capable model**; with a text-only model images are
  silently dropped via the fallback (document text still flows in). No UI hint yet.
- Attachment caps (5 images, 5 MB, ~8k chars/doc, last 20 comments) are constants
  in the services — not configurable.
- Speech audio cap is 25 MB, matching OpenAI transcription API limits.
- Speech diarization assumes exactly two participants; calls with conferences or
  transfers may be oversimplified.
- **Caller identification is phone-number-only.** If the caller's number is not in
  the database the ticket stays on the default applicant/company — there is no
  name-based guessing (intentionally removed; see Caller identification above).

UX:
- While pending, the section asks the live-update pulse to run every 4 s
  (`requestCadence`); the finished guide is a ticket write, so the card reloads
  by itself (`docs/live-updates.md`).
- Regenerating a guide rebuilds `items` from scratch. Nothing is lost with it —
  the per-item `done` flag has had no writer since the checkboxes were removed
  (2026-07-30); state lives in the ticket checklist the steps are copied into.
- Speech recognition is request/response for manual clicks; there is no progress
  polling beyond button spinner state.
- An existing transcript stays collapsed until «Расшифровка» is pressed: the
  summary already sits in the ticket description, and showing both would be one
  thought told twice.

---

## Touched files (reference)

Backend — models: `preferences.js`, `ticket.js`, **`aiFeedback.js`**;
types: `preferences.ts`, `ticket.ts`, `_shared.ts`.
Controllers/routes: `controllers/preferences.js`, `controllers/ticket.js`,
`controllers/knowledgeNote.js`, `routes/internal/preferences.js`,
`routes/internal/ticket.js`.
Services: `aiService.js`, **`ai/health.js`**, **`aiRules.js`**, `aiErrors.js`,
`ticketAiGuide.js`, **`ticketAiTerms.js`**, `knowledgeBaseContext.js`,
`attachmentExtractor.js`, `speechToTextService.js`, `callerIdentityService.js`,
`ticketCategoryService.js`, `aiTicketLog.js`, `crypto/secretBox.js`.
Helpers: `preferencesSecrets.js`, **`knowledgeNoteDerived.js`**.
Prompts: `ticketGuide.js`, `callSummary.js`, `transcription.js`,
`ticketCategory.js`, **`ticketTerms.js`**, **`termReference.js`**.
Middleware: `fileUpload.js`, `emailHandling.js`, `notifications.js`.
Scripts: **`migrateAiProvider.js`**. Plus `package.json`, `tsconfig.json`.

Frontend — settings: `components/Preferences/Ai.jsx`, **`AiRules.jsx`**,
**`channel-health.js`** (renamed from `mail-health.js`), `TicketsCollect.jsx`,
`Notifications.jsx`, `pages/Preferences.jsx`.
Ticket card: `View/AiGuideSection.jsx`, **`View/TicketTerms.jsx`**,
**`View/AiMark.jsx`**, `View/AttachmentStrip.jsx`, `View/AttachmentChip.jsx`,
`View/attachment-utils.js`, `View/Sections.jsx`, `Ticket/Chronicle.jsx`,
`Ticket/ticket-state.jsx`, `pages/Ticket/View.jsx`, `pages/Ticket/List.jsx`,
`util/ticket-events.js`, `store/prefs.js`, `styles/tailwind.css`
(`.ai-term`, `.ai-mark`).

Telegram-bot (self-contained category detection + its share of the AI rules):
`models/ticket.js`, `models/ticketCategory.js`, `models/preferences.js`,
**`models/aiFeedback.js`**, `services/ticketCategoryService.js`,
`services/crypto/secretBox.js`, `middleware/tgBotApi.js`.
