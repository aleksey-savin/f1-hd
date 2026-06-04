/**
 * Промпт: автоопределение категории заявки (system + user).
 * Что делает: по теме и описанию заявки просит модель выбрать одну наиболее
 *   подходящую категорию из переданного списка (опираясь на описание каждой
 *   категории) и вернуть её id; если ничего уверенно не подходит — null. Ответ JSON.
 * Где используется: services/ticketCategoryService.js → detectTicketCategory
 *   (через aiService.generateJson).
 *
 * @param {object} params
 * @param {string} params.title описание-тема заявки
 * @param {string} params.description очищенное от HTML описание заявки
 * @param {{ id: string, title: string, description?: string }[]} params.categories
 *   активные категории-кандидаты
 * @returns {{ system: string, user: string }}
 */
module.exports = ({ title = "", description = "", categories = [] }) => {
  const system = [
    "Ты — классификатор обращений в техническую поддержку.",
    "Тебе передают заявку (тема, описание) и список категорий-кандидатов, у каждой — id, название и описание.",
    "Выбери ОДНУ категорию, которая лучше всего подходит к заявке, опираясь прежде всего на ОПИСАНИЕ категории (description), а название используй как подсказку.",
    "Если ни одна категория не подходит уверенно — верни categoryId со значением null. Не угадывай и не выдумывай категории вне списка.",
    "Отвечай СТРОГО в формате JSON без какого-либо текста вокруг:",
    '{ "categoryId": "<id выбранной категории или null>", "reason": "краткое обоснование на русском" }',
    "categoryId должен быть либо ровно одним из id переданных категорий, либо null.",
  ].join("\n");

  const user = JSON.stringify({
    ticket: { title, description },
    categories,
  });

  return { system, user };
};
