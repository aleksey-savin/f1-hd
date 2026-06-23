# AI Integration — Implementation Notes

_Last updated: 2026-06-04. This document describes the AI features as currently
implemented, so the code can be reviewed and optimized later. It is a snapshot,
not a spec — verify against the code before relying on any detail._

## Overview

Four AI capabilities have been added:

1. **AI provider preferences** — admin chooses OpenAI or Anthropic and stores the
   API key + model. Models are fetched live from the provider. Speech recognition
   has its own provider switch under the same AI preferences tab: **OpenAI**
   (API key + model) or **Yandex SpeechKit** (API key + folder ID + `general`
   model).
2. **AI ticket solution guide (experimental)** — on ticket creation, the
   configured provider generates either a step-by-step solution guide or a
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
  description, categories }) → { system, user }` (§4).

---

## 1. Provider preferences

### Data — `backend/models/preferences.js`
Singleton `Preferences` doc gained an `ai` sub-document:
```
ai: {
  isActive: Boolean,
  provider: "openai" | "anthropic",
  openai:    { apiKey: String, model: String (default "gpt-4o") },
  anthropic: { apiKey: String, model: String (default "claude-opus-4-8") },
  speechToText: {
    isActive: Boolean,
    provider: "openai" | "yandex" (default "openai"),
    apiKey: String,                                   // OpenAI key
    model: String (default "gpt-4o-transcribe-diarize"), // OpenAI model
    yandex: {
      apiKey: String,
      folderId: String,
      model: String (default "general"),
    },
  },
}
```
- API keys are stored **plaintext**, matching the existing `emailPassword` /
  `notify.byEmail.pass` convention. **Tech debt** — candidate for encryption.

### Backend
- `controllers/preferences.js`
  - `update` — `ai` is wired through the destructure + create + update branches.
  - `getInitial` — returns `ai: { isActive, speechToText: { isActive } }` so the
    client can gate AI guide + speech controls.
  - `getAiModels` — `POST /api/preferences/ai-models { provider, apiKey, feature }`.
    Calls the provider's list-models endpoint (OpenAI `GET /v1/models`; Anthropic
    `GET /v1/models`). Normal chat models are filtered to `gpt*`/`o\d`/`chatgpt*`;
    `feature:"speechToText"` with `provider:"openai"` filters to speech-capable
    models (`gpt-4o-transcribe*`, `gpt-4o-mini-transcribe*`, `whisper-1`);
    `provider:"yandex"` short-circuits and returns the static `general` model
    (Yandex has no list-models endpoint, so no key/HTTP call is needed). Falls
    back to the saved key if none is passed. Admin-only.
- `routes/internal/preferences.js` — `POST /preferences/ai-models`
  (`isAuth, isAdmin`). Other AI settings ride the existing `POST /preferences`.

### Frontend
- `components/Preferences/Ai.jsx` — tab in Preferences: enable switch, provider
  select, masked API key, and a **model dropdown populated by fetching the
  provider** (refresh button; disabled until a key is entered). Also contains a
  separate **Speech recognition** switch and a **speech provider select**
  (OpenAI / Yandex SpeechKit). For OpenAI: API key field + model dropdown filtered
  to speech-to-text models (`gpt-4o-transcribe-diarize` preferred and marked as the
  model that supports role/speaker handling). For Yandex: API key + folder ID
  fields and a fixed `general` model.
- `pages/Preferences.jsx` — registers the "AI" tab; the existing submit handler
  persists `prefs.ai`.

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
    **no `temperature`** and `max_completion_tokens` (GPT‑5/o‑series reject a custom
    `temperature` and the deprecated `max_tokens` with a 400); Anthropic →
    `POST /v1/messages`, `max_tokens` (`maxTokens` or 1500),
    `anthropic-version: 2023-06-01`;
  - on a non-OK response the thrown error message **includes the provider's
    response body**, so the real cause is visible in logs;
  - `images` become provider-specific blocks (OpenAI `image_url`, Anthropic
    `image`/base64);
  - `parseJsonResponse` strips ```` ```json ```` fences / extracts outer braces
    before `JSON.parse`.
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
  - **pulls in relevant knowledge-base notes** via
    `services/knowledgeBaseContext.js` `collectRelevantNotes({ companyId, categoryId,
    applicantId })` — same company/category/applicant matching + ranking as the ticket
    "База знаний" tab (`RelatedNotes.jsx`), top 5, formatted by `buildKnowledgeContext`
    and appended to the prompt as a **priority source** (known issues/instructions).
    Per-user `canViewNote` is intentionally **not** applied — the guide is a shared
    staff-only artifact. The used notes are persisted on `aiGuide.sources`;
  - calls `generateJson` with images; **text-only fallback** if the vision call
    fails (e.g. non-vision model) so a guide is still produced;
  - persists `aiGuide` via `findByIdAndUpdate`; **never throws** — failures are
    recorded as `status:"error"`.

`backend/package.json` / `tsconfig.json` — added `@/services` and `@/prompts`
module aliases and deps `pdf-parse`, `mammoth`, `xlsx`.

### Controller / routes — `backend/controllers/ticket.js`, `routes/internal/ticket.js`
- `add` — sets `aiGuide.status` to `pending` (if AI on) and, **after** sending the
  201, fires `generateTicketAiGuide(...)` **without awaiting** (create stays fast).
- `getOne` — `delete doc.aiGuide` when `isEndUser` (internal aid only).
- `regenerateAiGuide` — `POST /tickets/ai-guide/generate { _id }`, **synchronous**,
  returns the refreshed guide.
- `toggleAiGuideItem` — `POST /tickets/ai-guide/toggle-item { _id, index, done }`.
- Both new routes: `isAuth, canPerformTickets`.

### Frontend
- `components/Ticket/View/AiGuide.jsx` — card showing the guide:
  - `pending` → spinner + **polls `GET /api/tickets/:num` every 4 s** until ready;
  - `solution` → summary + checkable `Form.Check` steps;
  - `questions` → warning + checkable question list;
  - `error`/`idle` → message; header **regenerate** button (also used to generate);
  - when `aiGuide.sources` is non-empty, a **"Источники из базы знаний"** section lists
    the used KB notes as links to `/knowledge-base/:id` (new tab), badged by note type
    via `util/knowledgeNoteTypes`;
  - checkbox toggles call the toggle endpoint and update the `view-ticket` store
    optimistically.
- `pages/Ticket/View.jsx` — renders `<AiGuide />` after the description, gated by
  `!isClient && ai?.isActive`.
- `store/prefs.js` — carries the `ai.isActive` flag from `getInitial`.

---

## 3. Speech recognition / call summary

### Data — `backend/models/ticket.js` (+ `types/_shared.ts`)
Ticket attachments now support a `speechToText` sub-document:
```
speechToText: {
  status: "idle" | "pending" | "ready" | "error",
  text: String,       // currently the same structured summary, for compatibility
  summary: String,    // structured Russian call summary shown in the UI
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
    recognized }`. `text` is currently set to the summary for compatibility with earlier
    UI/data reads; `title` is consumed by the email auto-trigger and ignored by the manual
    path; `recognized` is `true` only when ASR produced real non-empty speech (not just an
    empty fallback segment), and the email auto-trigger uses it to gate the ticket
    title/description overwrite (see §3 Email auto-trigger).

### Controller / routes — `backend/controllers/ticket.js`, `routes/internal/ticket.js`
- `POST /tickets/:ticketNum/attachments/speech-to-text` (`isAuth,
  canPerformTickets`) accepts `{ attachmentName }`.
- The controller sets the attachment `speechToText.status` to `pending`, calls
  `transcribeAttachment`, then persists `ready` with summary/segments/model/time
  or `error` with the provider/service message.
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
- `UI/AttachmentPreview.jsx`:
  - audio attachments show an inline audio player plus action buttons for download,
    speech recognition, and delete;
  - the speech action is an icon button with tooltip (`title="Распознать речь"`);
  - recognition results are displayed in a Bootstrap accordion titled
    **"Итог разговора"**;
  - after a successful manual recognition, the accordion opens automatically;
  - when opening an existing ticket page, saved results are closed by default;
  - the accordion body renders the **dialog** — diarized `segments` as
    `speaker: text` lines (falling back to `text`/`summary` if no segments).
    Errors still use a danger alert.
- `components/Ticket/View/Attachments.jsx`:
  - gates recognition by `!ticket.isArchived`, `permissions.canPerformTickets`,
    and `ai.speechToText.isActive`;
  - calls the speech route and updates the `view-ticket` store with returned
    attachments.
- `store/prefs.js` carries `ai.speechToText.isActive` from `getInitial`.
- `UI/AiSpeechBadge.jsx` — renders `ticket.aiSpeech.status`: `pending` → spinner +
  "ИИ обрабатывает запись", `processed` → green "Обработана ИИ", `error` → danger.
  - **Ticket view** (`pages/Ticket/View.jsx`, staff only): shown under the title;
    while `pending` it polls `GET /api/tickets/:num` every 5 s and, once the status
    changes, calls `revalidator.revalidate()` so the title/description/badge refresh
    without a manual reload.
  - **Ticket list** (`components/Ticket/Item.jsx` via the `ItemCard` badges array):
    `pages/Ticket/List.jsx` re-fetches the opened list every 5 s while any row is
    `pending`, so all badges update live with a single request. The poll uses the
    store's `silentRefresh` (in `store/lists/tickets.js`), which updates
    `originalList`/`filteredList` atomically **without** touching `isLoading`/
    `isSorting` and sets a `silentUpdate` flag so the page skips the re-filter/sort
    effect. This keeps `ListWrapper` from swapping the list for a `<Spinner>`, so
    rows update in place (stable `key={item._id}`) with no fade-out/fade-in.

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
  creation (when no `categoryId` and `ai.isActive`); after the 201 a background chain runs
  `detectTicketCategory` **then** `generateTicketAiGuide`, so the guide already sees the
  detected category. Never blocks/fails ticket creation.
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
- `UI/AiCategoryBadge.jsx` — `pending` → spinner "ИИ подбирает категорию"; `error` → danger
  "Не удалось определить категорию"; `processed` → no badge (the category itself is shown).
- `pages/Ticket/View.jsx` renders it next to `AiSpeechBadge` under the title; the existing
  poll now also runs while `aiCategory.status === "pending"` and revalidates when it
  resolves.
- `components/Ticket/Item.jsx` adds an "ИИ подбирает категорию" badge; `pages/Ticket/List.jsx`
  extends the live-refresh `anyPending` check to `aiCategory.status === "pending"`.

---

## API summary

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/preferences/ai-models` | admin | list provider models |
| POST | `/api/tickets/ai-guide/generate` | staff | (re)generate guide for a ticket |
| POST | `/api/tickets/ai-guide/toggle-item` | staff | toggle a step/question done |
| POST | `/api/tickets/:ticketNum/attachments/speech-to-text` | staff | summarize an audio attachment |

(Provider settings persist via the existing `POST /api/preferences`; AI guide and
speech results are returned inside the existing `GET /api/tickets/:num`.)

---

## Known limitations / optimization opportunities

Operational / correctness:
- **Container deps**: `pdf-parse`/`mammoth`/`xlsx` were added to `package.json` but
  the Docker image must be rebuilt (or `pnpm install` run in-container) — the
  container ships its own `node_modules`.
- **Fire-and-forget generation**: if the process restarts mid-generation, a ticket
  can stay `status:"pending"` until someone clicks Regenerate. A cron sweep for
  stale `pending` guides and speech recognition results (mirroring the
  notifications cron) would make it robust.
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
- **Plaintext API key storage** (see above).
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
- Frontend polls every 4 s while pending (no websocket/SSE).
- Checkbox state is replaced on regenerate (items array is rebuilt).
- Speech recognition is request/response for manual clicks; there is no progress
  polling beyond button spinner state.
- Existing speech summaries are collapsed by default when opening a ticket, even
  if recognition previously succeeded.

---

## Touched files (reference)

Backend: `models/preferences.js`, `models/ticket.js`, `types/ticket.ts`,
`types/_shared.ts`,
`controllers/preferences.js`, `controllers/ticket.js`, `routes/internal/ticket.js`,
`services/aiService.js`, `services/ticketAiGuide.js`,
`services/knowledgeBaseContext.js`,
`services/attachmentExtractor.js`, `services/speechToTextService.js`,
`services/callerIdentityService.js`, `services/ticketCategoryService.js`,
`services/aiTicketLog.js`,
`prompts/ticketGuide.js`, `prompts/callSummary.js`, `prompts/transcription.js`,
`prompts/ticketCategory.js`,
`middleware/fileUpload.js`, `middleware/emailHandling.js`, `package.json`,
`tsconfig.json`.

Frontend: `components/Preferences/Ai.jsx`, `pages/Preferences.jsx`,
`components/Ticket/View/AiGuide.jsx`, `components/Ticket/View/Attachments.jsx`,
`UI/AttachmentPreview.jsx`, `UI/AiSpeechBadge.jsx`, `UI/AiCategoryBadge.jsx`,
`pages/Ticket/View.jsx`,
`pages/Ticket/List.jsx`, `components/Ticket/Item.jsx`, `store/prefs.js`.

Telegram-bot (self-contained category detection): `models/ticket.js`,
`models/ticketCategory.js`, `models/preferences.js`,
`services/ticketCategoryService.js`, `middleware/tgBotApi.js`.
