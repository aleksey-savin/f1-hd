# Ticket templates: the questionnaire model

Implementation notes for ticket templates and the answers they collect. UI
conventions live in [ux-ui-guide](./ux-ui-guide.md) ("Переиспользуемые доменные
блоки", "Раскладка полей внутри формы"); this file is the data contract.

## Where the logic lives

| Piece | Path |
|---|---|
| Pure logic (no Mongoose): types, normalisation, validation, composition | `backend/services/ticketQuestionnaire.js` (+ `.test.js`, `pnpm test`) |
| Client twin of the vocabulary | `frontend/src/components/app/custom-fields.ts` (+ `.test.js`, `node --test`) |
| Template schema | `backend/models/ticketTemplate.js` — spreads `ticketDefaultFieldsSchema` from `backend/models/ticket.js` |
| Template controller | `backend/controllers/ticketTemplate.js` (`buildTemplateData`, `canSeeTemplate`) |
| Ticket creation / update | `backend/controllers/ticket.js` (`add`, `update`) |

The two vocabularies are deliberate twins, not shared code (the backend is
CommonJS and the frontend is an ESM bundle). They must agree on the answer shape
per type; a change to one is a change to both.

## Field definition

`customFields` lives on the shared `ticketDefaultFieldsSchema`, so a template
carries the **definition** and a ticket carries a **snapshot of the definition
plus the answer**:

```js
{
  key: String,      // stable id, server-assigned (crypto.randomUUID)
  name: String,     // the question as the initiator reads it
  type: String,     // text | select | multiselect | boolean | number | date
  options: [String],// select/multiselect only, trimmed and deduped
  required: Boolean,
  hint: String,     // help text under the question
  value: Mixed,     // template: the default answer; ticket: the answer
}
```

The snapshot is what makes the ticket card readable after the template is
edited: templates get reworked long after tickets were created, and the card
must show the question as it was asked.

`key` is the identity, `name` is a label. Answers are matched by `key`, falling
back to `name` for templates created before keys existed
(`backfillTemplateFieldKeys.js` / `pnpm migrate:template-field-keys` assigns the
missing ones; without it, keys appear on the template's next save).

## Answer format per type

| Type | Stored answer | Empty |
|---|---|---|
| `text`, `select` | `String` (trimmed) | `""` |
| `multiselect` | `String[]`, only listed options, in option order | `[]` |
| `boolean` | `true` / `false` | `null` |
| `number` | finite `Number` (a submitted `"1,5"` is parsed) | `null` |
| `date` | day key `"YYYY-MM-DD"`, no timezone (see [datetime-conventions](./datetime-conventions.md)) | `null` |

`hasAnswer(type, value)` is the single definition of "answered": blanks, empty
arrays, `null` and non-finite numbers are not answers. `formatAnswer(field)`
renders one for humans (`Да`/`Нет`, `15.09.2026`, comma-joined list).

While a number is being typed the form keeps the raw string (`"1,"`, `"-"`);
the server parses it. Don't coerce mid-typing.

## Description mode

`descriptionMode` on the template — `"required" | "optional" | "hidden"`,
default `"required"` (so untouched templates behave exactly as before; no data
migration).

`hidden` requires at least one question, or `buildTemplateData` answers 400.

The mode says what the **form asks for**, not what the server accepts — a
client's questionnaire sends no description in `hidden` mode, but staff always
have the editor, and text they submit is kept. On creation (`ticket.add`):

1. An empty description plus at least one answer → the server composes it:
   one `<p><strong>Name:</strong> answer</p>` per answered question, in template
   order. `descriptionComposed` is set on the ticket.
2. An empty description with no answers → 400 when the mode is `required`.
3. Whatever the person wrote is stored as written, in every mode.

In the form the description has exactly one place: `required`/`optional` show
the editor **first**, prefilled with the template's text (that is what
`applyTemplate` copies into the form's state); `hidden` shows the template's
text read-only in that same spot and no editor at all. The editor reads
`initialValue` only on mount, so it carries a `key` of the template id —
without it a template picked from the header lands in state but not on screen.
Template descriptions authored before the markdown migration are HTML and newer
ones are markdown, so `UI/MarkdownEditor` sniffs the preset (`setHTML` vs
`setMarkdown`) and emits the normalised HTML once, or an untouched preset would
be stored as its own source.

Composition is what keeps everything downstream unchanged: `deriveTicketTitle`,
the notification emails (`middleware/notifications.js`), the Telegram render
(`tg-service`) and the AI prompt (`services/ticketAiGuide.js`) all read
`description` and know nothing about questionnaires. **Every name and answer is
HTML-escaped in `composeDescription`** — the string is inlined raw into email
HTML and sanitised with DOMPurify on the card.

The title of a composed ticket is the **template's** title:
`deriveTicketTitle` on composed HTML would yield "ФИО: Иванов". The AI title
pass is skipped for those (`wantsAiTitle`), or the ticket would keep a
permanent `aiTitle: pending` badge.

`descriptionComposed` also gates the card's "Ответы" section: when the
description *is* the answers, showing both is one fact in two places. Staff
editing the text by hand clears the flag; editing answers while the flag stands
recomposes the description.

## Validation contract

`buildTemplateData` (template add/update) — 400 with a Russian message the form
shows verbatim:

- a question of a choice type with no options → `У вопроса «X» нет вариантов`;
- `hidden` with no questions → `Без описания нужен хотя бы один вопрос`.

Nameless rows are dropped silently: an unfinished row in the builder is not an
error.

`ticket.add` resolves the template **by id** (`templateId` in the body; the
whole-document `template` JSON of older clients is accepted for its `_id`
only), 404 when it is gone, 403 when `canSeeTemplate` says no. Then
`collectAnswers` walks the template's definitions:

- answers are ordered by the template, unknown submitted fields are dropped;
- an unusable answer (an option not in the list, garbage in a number or date)
  is reported once — never also as "missing";
- a `required` question with no answer → `Ответьте на вопрос «X»`.

All messages of a failed submit are joined into one 400.

`ticket.update` is deliberately laxer: it normalises by the snapshot's own type
and does **not** enforce `required` — legacy tickets carry no `required` flags
and must stay saveable. It touches `customFields` only when the key is present
in the body (a request that omits it used to wipe every answer).

The external API (`controllers/external/ticket.js`) has no template support and
is untouched: it keeps its name-only filter.

## Compatibility

- Existing templates: `descriptionMode` comes from the schema default; `key`,
  `required` and `hint` are absent and read as "no key, not required, no hint".
- Existing tickets: unchanged, and the card falls back to matching by name.
- Older clients: still work — `templateId` falls back to `template._id`, and the
  field shape is a superset of the old one.
