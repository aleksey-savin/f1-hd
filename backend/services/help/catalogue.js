const fs = require("node:fs");
const path = require("node:path");

const { parseFrontMatter } = require("./frontMatter");

/**
 * Каталог справки: разделы из help/sections.js, статьи — файлы
 * help/<аудитория>/<раздел>/<статья>.md. Негодный файл не роняет справку:
 * он пропускается, а причина уходит в предупреждения.
 */
const HELP_ROOT = path.resolve(__dirname, "../../help");
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Дата из шапки: ГГГГ-ММ-ДД и при этом настоящий день календаря —
// «2026-13-01» уронил бы форматирование на странице статьи
const isDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
// Ссылка только внутрь портала: «/путь», но не «//хост»
const INTERNAL_LINK = /^\/(?!\/)/;

const readArticle = (file, slug) => {
  const parsed = parseFrontMatter(fs.readFileSync(file, "utf8"));
  if (!parsed) return { error: "нет шапки" };
  const { meta, body } = parsed;
  if (!meta.title || !meta.summary) return { error: "нет title или summary" };

  // Пустой `order:` — «без порядка», а не ноль
  const order = meta.order?.trim() ? Number(meta.order) : NaN;
  const linked = INTERNAL_LINK.test(meta.link || "") && Boolean(meta.linkLabel);
  return {
    article: {
      slug,
      title: meta.title,
      summary: meta.summary,
      order: Number.isFinite(order) ? order : null,
      updated: isDate(meta.updated) ? meta.updated : null,
      link: linked ? meta.link : null,
      linkLabel: linked ? meta.linkLabel : null,
      body,
    },
  };
};

const byOrder = (a, b) => {
  if (a.order !== null && b.order !== null) return a.order - b.order;
  if (a.order !== null) return -1;
  if (b.order !== null) return 1;
  return a.title.localeCompare(b.title, "ru");
};

const listDir = (dir) => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
};

const loadCatalogue = (root, defs) => {
  const warnings = [];
  const sections = defs.map((def) => ({ ...def, articles: [] }));
  const find = (audience, key) =>
    sections.find((s) => s.audience === audience && s.key === key);

  for (const audience of ["client", "staff"]) {
    for (const dir of listDir(path.join(root, audience))) {
      if (!dir.isDirectory()) continue;
      const section = find(audience, dir.name);
      for (const entry of listDir(path.join(root, audience, dir.name))) {
        if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
        const where = `${audience}/${dir.name}/${entry.name}`;
        const slug = entry.name.slice(0, -3);
        if (!section) {
          warnings.push(`${where}: раздела нет в sections.js`);
          continue;
        }
        if (!NAME.test(slug)) {
          warnings.push(`${where}: имя файла — латиница, цифры, дефис`);
          continue;
        }
        // Нечитаемый файл — такая же негодная статья: каталог нужен и
        // профилю (/api/me), ронять его из-за одного файла нельзя
        let article;
        let error;
        try {
          ({ article, error } = readArticle(
            path.join(root, audience, dir.name, entry.name),
            slug,
          ));
        } catch (cause) {
          error = `не читается (${cause.code || cause.message})`;
        }
        if (error) warnings.push(`${where}: ${error}`);
        else section.articles.push(article);
      }
    }
  }

  for (const section of sections) section.articles.sort(byOrder);
  return { sections, warnings };
};

let cached = null;
const getCatalogue = () => {
  if (cached) return cached;
  const catalogue = loadCatalogue(HELP_ROOT, require("../../help/sections"));
  for (const warning of catalogue.warnings) {
    console.warn(`[help] ${warning}`);
  }
  // Вне прода читаем каждый раз: правка файла статьи видна без перезапуска
  if (process.env.NODE_ENV === "production") cached = catalogue;
  return catalogue;
};

module.exports = { HELP_ROOT, NAME, loadCatalogue, getCatalogue };
