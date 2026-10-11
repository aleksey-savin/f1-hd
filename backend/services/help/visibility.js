/**
 * Кто что видит в справке. Чистые функции: читатель — это
 * `{ isEndUser, modules }`, где modules — Preferences.modules.
 * Клиент видит только клиентскую часть, сотрудник — обе.
 */
const audiencesFor = (isEndUser) => (isEndUser ? ["client"] : ["staff", "client"]);

const moduleOpen = (section, modules) =>
  !section.modules?.length ||
  section.modules.some((key) => Boolean(modules?.[key]?.isActive));

const visibleSections = (sections, { isEndUser, modules }) => {
  const audiences = audiencesFor(isEndUser);
  return sections.filter(
    (section) =>
      audiences.includes(section.audience) &&
      section.articles.length > 0 &&
      moduleOpen(section, modules),
  );
};

const hasHelp = (sections, reader) => visibleSections(sections, reader).length > 0;

const findSection = (sections, reader, audience, key) =>
  visibleSections(sections, reader).find(
    (section) => section.audience === audience && section.key === key,
  ) || null;

const findArticle = (sections, reader, audience, key, slug) => {
  const section = findSection(sections, reader, audience, key);
  const article = section?.articles.find((item) => item.slug === slug);
  return article ? { section, article } : null;
};

module.exports = { audiencesFor, visibleSections, hasHelp, findSection, findArticle };
