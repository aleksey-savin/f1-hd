// Чистые функции справки (pages/Help): поиск по оглавлению, адреса, рейка.

/** Поиск по названию и аннотации; порядок — как в оглавлении. */
export const searchArticles = (sections, query) => {
  const needle = String(query || "")
    .trim()
    .toLowerCase();
  if (!needle) return [];
  return sections.flatMap((section) =>
    section.articles
      .filter((article) =>
        `${article.title}\n${article.summary}`.toLowerCase().includes(needle),
      )
      .map((article) => ({
        ...article,
        section: { key: section.key, title: section.title },
      })),
  );
};

const IMAGE_PATH = "(?:\\./)?(img/[A-Za-z0-9][A-Za-z0-9._-]*)";
const INLINE_IMAGE = new RegExp(`(!\\[[^\\]]*\\]\\()${IMAGE_PATH}`, "g");
const IMAGE_DEFINITION = new RegExp(`^( {0,3}\\[[^\\]]+\\]:\\s*)${IMAGE_PATH}`);
const FENCE = /^\s*(```|~~~)/;
const CODE_SPAN = /(`+[^`]*`+)/;

/**
 * Картинки статьи лежат рядом с ней: `img/файл` (или `./img/файл`) → адрес
 * маршрута справки. Понимает и ссылочный синтаксис (`[s]: img/файл`). Код не
 * трогает: статья о том, как писать статьи, показывает путь как есть.
 */
export const resolveImages = (body, base) => {
  let fenced = false;
  return String(body || "")
    .split("\n")
    .map((line) => {
      if (FENCE.test(line)) {
        fenced = !fenced;
        return line;
      }
      if (fenced) return line;
      if (IMAGE_DEFINITION.test(line)) {
        return line.replace(IMAGE_DEFINITION, `$1${base}/$2`);
      }
      return line
        .split(CODE_SPAN)
        .map((part, index) =>
          index % 2 ? part : part.replace(INLINE_IMAGE, `$1${base}/$2`),
        )
        .join("");
    })
    .join("\n");
};

/** Рейка «На этой странице» появляется от трёх заголовков. */
export const railSections = (headings) =>
  headings.length < 3
    ? []
    : headings.map((label, index) => ({ id: `h-${index + 1}`, label }));

export const articlePath = (audience, section, slug) =>
  `/help/${audience}/${section}/${slug}`;

/** Якорь раздела на оглавлении; с префиксом, чтобы не совпасть с чужим id. */
export const sectionAnchor = (sectionKey) => `help-${sectionKey}`;

/** Клиентскую часть сотрудник открывает с `?for=client`; клиенту параметр не нужен. */
export const indexPath = (audience, isEndUser, sectionKey) =>
  `/help${!isEndUser && audience === "client" ? "?for=client" : ""}${
    sectionKey ? `#${sectionAnchor(sectionKey)}` : ""
  }`;

const DAY = new Intl.DateTimeFormat("ru", { day: "numeric", month: "long" });

/**
 * Дата из шапки статьи (ГГГГ-ММ-ДД) словами: «11 октября», год — только когда
 * он не текущий. Календарная, без пояса. Негодная дата — пустая строка.
 */
export const formatUpdated = (iso, now = new Date()) => {
  const date = new Date(`${iso}T00:00:00`);
  if (!iso || Number.isNaN(date.getTime())) return "";
  const day = DAY.format(date);
  return date.getFullYear() === now.getFullYear()
    ? day
    : `${day} ${date.getFullYear()}`;
};
