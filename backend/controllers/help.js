const path = require("node:path");

const Preferences = require("@/models/preferences");
const { AppError } = require("@/middleware/errorHandling");
const { getCatalogue, HELP_ROOT } = require("@/services/help/catalogue");
const {
  audiencesFor,
  visibleSections,
  findSection,
  findArticle,
} = require("@/services/help/visibility");

/**
 * Справка портала (docs/help.md). Статьи — файлы в backend/help; что из них
 * видит читатель, решает services/help/visibility. Любой отказ — 404 без
 * причины: клиенту незачем знать, что сотрудническая статья существует.
 */
const IMAGE = /^[a-z0-9][a-z0-9._-]*\.(png|jpe?g|webp|gif)$/i;

const readerOf = async (req) => {
  const preferences = await Preferences.findOne({}).select("modules").lean();
  return {
    isEndUser: req.auth.isEndUser,
    modules: preferences?.modules || {},
  };
};

const notFound = () => new AppError("Страница справки не найдена", 404);

exports.index = async (req, res, next) => {
  try {
    const reader = await readerOf(req);
    const sections = visibleSections(getCatalogue().sections, reader);
    const audiences = audiencesFor(reader.isEndUser)
      .map((key) => ({
        key,
        sections: sections
          .filter((section) => section.audience === key)
          .map((section) => ({
            key: section.key,
            title: section.title,
            articles: section.articles.map(({ slug, title, summary }) => ({
              slug,
              title,
              summary,
            })),
          })),
      }))
      .filter((audience) => audience.sections.length > 0);
    res.status(200).json({ audiences });
  } catch (error) {
    next(new AppError("Не удалось загрузить справку", 500, true, error));
  }
};

exports.article = async (req, res, next) => {
  try {
    const { audience, section: key, slug } = req.params;
    const found = findArticle(
      getCatalogue().sections,
      await readerOf(req),
      audience,
      key,
      slug,
    );
    if (!found) return next(notFound());

    const { section, article } = found;
    res.status(200).json({
      audience,
      slug: article.slug,
      title: article.title,
      summary: article.summary,
      updated: article.updated,
      link: article.link,
      linkLabel: article.linkLabel,
      body: article.body,
      section: { key: section.key, title: section.title },
      siblings: section.articles
        .filter((item) => item.slug !== article.slug)
        .map(({ slug: sibling, title }) => ({ slug: sibling, title })),
    });
  } catch (error) {
    next(new AppError("Не удалось загрузить статью", 500, true, error));
  }
};

exports.image = async (req, res, next) => {
  try {
    const { audience, section: key, file } = req.params;
    const section = findSection(
      getCatalogue().sections,
      await readerOf(req),
      audience,
      key,
    );
    if (!section || !IMAGE.test(file)) return next(notFound());

    res.set("X-Content-Type-Options", "nosniff");
    res.sendFile(
      file,
      { root: path.join(HELP_ROOT, audience, key, "img"), dotfiles: "deny" },
      (error) => {
        if (error && !res.headersSent) next(notFound());
      },
    );
  } catch (error) {
    next(new AppError("Не удалось загрузить картинку", 500, true, error));
  }
};
