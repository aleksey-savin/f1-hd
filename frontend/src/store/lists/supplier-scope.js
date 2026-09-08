/**
 * Срез закупок поставщика под выбранные год и компанию.
 *
 * Бэкенд отдаёт закупки корзинами «год × компания» (`purchases`), а какие из
 * них сложить, решает панель списка: справочник маленький, и держать срезы на
 * сервере значило бы ходить туда на каждый чип.
 *
 * Модуль намеренно без зависимостей (бизнес-год приходит аргументом из стора):
 * тест рядом гоняется голым `node --test src/store/lists/supplier-scope.test.js`.
 */

const sum = (buckets, field) =>
  buckets.reduce((total, bucket) => total + (bucket[field] || 0), 0);

/**
 * Итоги строки: количество, сумма и поставки — за выбранный год (`year: null`
 * — за всё время, включая позиции без даты закупки).
 *
 * Дата последней закупки считается МИМО года: иначе у поставщика, у которого
 * в этом году тихо, она бы просто пропала, а именно она и говорит, насколько
 * он остыл. Компанию она при этом учитывает — спрашивают «когда мы у него
 * последний раз брали для них».
 */
export const scopeTotals = (item, { year = null, companyId = null } = {}) => {
  const forCompany = (item.purchases || []).filter(
    (bucket) => !companyId || bucket.companyId === companyId,
  );
  const scoped =
    year === null
      ? forCompany
      : forCompany.filter((bucket) => bucket.year === year);
  // Даты приходят строками ISO — они сравнимы как строки, поэтому максимум
  // берётся обычной сортировкой.
  const dates = forCompany
    .map((bucket) => bucket.lastPurchaseAt)
    .filter(Boolean)
    .sort();
  return {
    deviceCount: sum(scoped, "deviceCount"),
    totalSpent: sum(scoped, "totalSpent"),
    deliveryCount: sum(scoped, "deliveryCount"),
    lastPurchaseAt: dates.length ? dates[dates.length - 1] : null,
  };
};

/** Компании, для которых у поставщиков вообще были закупки. */
export const companyOptions = (list = []) =>
  [
    ...new Map(
      list
        .flatMap((item) => item.purchases || [])
        .filter((bucket) => bucket.companyId && bucket.companyName)
        .map((bucket) => [
          bucket.companyId,
          { value: bucket.companyId, label: bucket.companyName },
        ]),
    ).values(),
  ].sort((a, b) => a.label.localeCompare(b.label, "ru"));

/**
 * Годы, в которые что-то покупали. `alwaysYear` (текущий год по бизнес-зоне)
 * есть в списке всегда — он выбран по умолчанию, даже если закупок в нём ещё
 * не было.
 */
export const yearOptions = (list = [], alwaysYear) => {
  const years = new Set(
    list
      .flatMap((item) => item.purchases || [])
      .map((bucket) => bucket.year)
      .filter(Boolean),
  );
  if (alwaysYear) years.add(alwaysYear);
  return [...years]
    .sort((a, b) => b - a)
    .map((year) => ({ value: String(year), label: String(year) }));
};
