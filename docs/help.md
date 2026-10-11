# Help (in-portal user documentation)

Implementation notes for the «Справка» section. UI conventions live in
`docs/ux-ui-guide.md` («Справка»); this file covers the content layout, the
visibility rules and the endpoints.

## Content layout

Articles are Markdown files in the backend image. Nothing is stored in the
database and there is no editor in the portal.

```
backend/help/
  sections.js                        section catalogue
  client/<section>/<article>.md      articles for clients
  client/<section>/img/<file>        images of that section
  staff/<section>/<article>.md       articles for staff
```

The directory ships with `sections.js` only. A section with no articles is not
shown to anyone, so the catalogue can list sections ahead of their content.

## Adding an article

1. Pick the section key from `backend/help/sections.js` and the audience
   (`client` or `staff`).
2. Create `backend/help/<audience>/<section>/<name>.md`. `<name>` becomes the
   URL segment: lowercase Latin letters, digits and single hyphens
   (`^[a-z0-9]+(?:-[a-z0-9]+)*$`).
3. Start the file with a header between two `---` lines, then write Markdown.

```markdown
---
title: Как подать заявку
summary: Выберите на главной, что случилось, и ответьте на несколько вопросов.
order: 1
updated: 2026-10-11
link: /dashboard
linkLabel: Открыть главную
---

## Шаги

1. Откройте **Главную**.
2. Выберите плитку с подходящей темой.

> **Важно.** Одна заявка — один вопрос.

![Плитки на главной](img/tiles.png)
```

| Field | Required | Meaning |
|---|---|---|
| `title` | yes | Article heading and its line in the contents |
| `summary` | yes | One or two sentences under the heading; the search looks here and in `title` |
| `order` | no | Position inside the section. Articles without it follow the ordered ones, sorted by title |
| `updated` | no | `YYYY-MM-DD`; anything else is ignored |
| `link` + `linkLabel` | no | A button leading into the portal. `link` must start with a single `/`; both fields are required together. The button is hidden from a reader who has no right to the target section (`frontend/src/util/sections.ts`) |

The header is flat `key: value` pairs parsed by `services/help/frontMatter.js`
(no YAML library): a value may contain colons and may be wrapped in quotes.

Body conventions: `##` headings feed the "on this page" rail (shown from three
headings), an ordered list is a sequence of steps, a blockquote is a note, bold
marks button and field names. Do not write the product name in articles — each
installation carries its own brand; say «портал».

A file with a bad name, without a closed header, or without `title`/`summary`
is skipped and reported with `console.warn("[help] …")`; the rest of the help
keeps working. The same happens to an article in a folder that `sections.js`
does not list.

## Images

Put images in `img/` next to the articles of the section and reference them
with a relative path (`img/name.png` or `./img/name.png`), inline or through a
reference definition (`[s]: img/name.png`). Allowed types: png, jpg/jpeg, webp,
gif. The frontend rewrites the relative path to the image endpoint below
(`resolveImages` in `frontend/src/util/help.js`); absolute URLs and anything
inside code spans or fenced code blocks are left alone.

Images are served by the help endpoint, not from `/uploads`: `/uploads` has no
access check, and a staff screenshot must not be reachable by a client.

## Sections

`backend/help/sections.js` is an ordered array of
`{ audience, key, title, modules? }`. The order in the file is the order on the
page. `modules` lists keys of `Preferences.modules`; the section is visible when
at least one of them is active.

## Who sees what

Rules live in `services/help/visibility.js` (pure functions over
`{ isEndUser, modules }`):

- a client sees the `client` audience only; a staff member sees `staff` first
  and `client` second;
- a section is dropped when it has no articles or all its modules are off;
- `hasHelp` is true when at least one section survives. `/api/me` returns it as
  `prefs.hasHelp`, and the footer link to the help exists only then.

Permissions of the access dictionary are not consulted: every signed-in user
may read the help of their audience.

## API

All routes require a session (`routes/internal/help.js`,
`controllers/help.js`).

| Route | Returns |
|---|---|
| `GET /api/help` | `{ audiences: [{ key, sections: [{ key, title, articles: [{ slug, title, summary }] }] }] }` — visible audiences and sections only |
| `GET /api/help/:audience/:section/:slug` | `{ audience, slug, title, summary, updated, link, linkLabel, body, section: { key, title }, siblings: [{ slug, title }] }` |
| `GET /api/help/:audience/:section/img/:file` | the image file, `X-Content-Type-Options: nosniff` |

Every refusal is a 404 with no reason: a foreign audience, a section hidden by
a module switch, an unknown article, a file name outside the allowed pattern.
The article and the image are looked up in the already filtered catalogue, so a
path parameter never reaches the file system unless it names a visible section.

## Catalogue cache

`services/help/catalogue.js#getCatalogue` reads the directory once per process
in production: a new article appears after a deploy. Outside production the
directory is read on every call, so an edited file shows up on reload.

## Tests

```
cd backend && node --test services/help/*.test.js controllers/help.test.js
cd frontend && node --test src/util/help.test.js
```
