/**
 * Снимок расчёта отчёта по услуге — то, что сформировано и подписано.
 *
 * Раньше отчёт хранил только две суммы (`price`, `additionalPrice`), а карточка
 * и выгрузка пересчитывали разбивку заново — по НЫНЕШНИМ условиям услуги и
 * нынешним работам. Стоило после формирования поправить услугу (период
 * тарификации 60 → 15 минут), и один и тот же отчёт показывал 2 500 ₽ в списке
 * стадии и 1 250 ₽ в карточке. Документ, который клиент согласовал и по
 * которому выставлен счёт, не должен менять цифры от правки услуги.
 *
 * Снимок снимается при формировании и повторной отправке: условия расчёта,
 * итоги и разбивка по работам вместе с их временем. Карточка, выгрузка и
 * страница по ссылке читают его, а не считают заново. Превью остаётся живым —
 * отчётом оно ещё не стало.
 *
 * Заморожены цифры и время, не текст: описание работы, заявки и люди берутся
 * из самой работы.
 *
 * Модуль чистый — без базы и без моделей.
 */

const idOf = (value) => String(value?._id ?? value);

/**
 * Снимок из результата `priceWorks` (services/servicePlanBilling).
 * `works` — те же работы, что считались: из них берётся время начала и конца.
 */
const buildSnapshot = ({ priced, works, zone, at = new Date() }) => {
  const workById = new Map((works || []).map((work) => [idOf(work), work]));
  const rowOf = (item, withCost) => {
    const work = workById.get(idOf(item.workId));
    return {
      work: item.workId,
      startedAt: work?.startedAt ?? null,
      finishedAt: work?.finishedAt ?? null,
      minutes: item.minutes,
      ...(withCost ? { cost: item.cost } : {}),
    };
  };
  const tariff = priced.tariff || {};

  return {
    at,
    zone,
    terms: {
      tariffType: tariff.type ?? null,
      tariffingPeriod: tariff.tariffingPeriod ?? 0,
      // Только то, что участвует в расчёте: служебные _id пакетов не нужны
      hourPackages: (tariff.hourPackages || []).map((item) => ({
        hours: item.hours,
        pricePerHour: item.pricePerHour,
      })),
      packageBasis: priced.packageBasis
        ? {
            hours: priced.packageBasis.hours,
            pricePerHour: priced.packageBasis.pricePerHour,
            mode: priced.packageBasis.mode,
          }
        : null,
      fixedPrice: tariff.fixedPrice ?? 0,
      pricePerHour: tariff.pricePerHour ?? 0,
      pricePerHourNonWorking: tariff.pricePerHourNonWorking ?? 0,
    },
    workingTimeMinutes: priced.workingTimeMinutes,
    overtimeMinutes: priced.overtimeMinutes,
    price: priced.price,
    additionalPrice: priced.additionalPrice,
    total: priced.total,
    worktimeWorks: (priced.worktimeWorks || []).map((item) =>
      rowOf(item, false),
    ),
    overtimeWorks: (priced.overtimeWorks || []).map((item) =>
      rowOf(item, true),
    ),
  };
};

/**
 * Секции карточки из снимка: расчёт, условия и две таблицы работ.
 *
 * `works` — работы отчёта как их отдаёт populate: из них берётся текст строки
 * (описание, заявки, исполнитель). Работу могли удалить — её строка остаётся с
 * замороженными цифрами, иначе таблица перестала бы сходиться с итогом.
 */
const cardFromSnapshot = (snapshot, works, subdivisionOf) => {
  const workById = new Map((works || []).map((work) => [idOf(work), work]));
  const rowsOf = (rows) =>
    (rows || []).map((row) => {
      const work = workById.get(idOf(row.work));
      const base = work || {
        _id: row.work,
        description: "Работа удалена",
        tickets: [],
        finishedBy: null,
      };
      return {
        ...base,
        // Время — из снимка: правка работы после формирования строку не двигает
        startedAt: row.startedAt ?? base.startedAt,
        finishedAt: row.finishedAt ?? base.finishedAt,
        billedMinutes: row.minutes,
        cost: row.cost,
        subdivision: work && subdivisionOf ? subdivisionOf(work) : null,
      };
    });

  const terms = snapshot.terms || {};
  return {
    calc: {
      workingTimeMinutes: snapshot.workingTimeMinutes,
      overtimeMinutes: snapshot.overtimeMinutes,
      price: snapshot.price,
      additionalPrice: snapshot.additionalPrice,
      total: snapshot.total,
    },
    terms: {
      type: terms.tariffType,
      tariffingPeriod: terms.tariffingPeriod,
      hourPackages: terms.hourPackages,
      packageBasis: terms.packageBasis,
      fixedPrice: terms.fixedPrice,
      pricePerHour: terms.pricePerHour,
      pricePerHourNonWorking: terms.pricePerHourNonWorking,
    },
    worktimeWorks: rowsOf(snapshot.worktimeWorks),
    overtimeWorks: rowsOf(snapshot.overtimeWorks),
    // Расчёт восстановлен задним числом (см. pinToStored) — карточка обязана
    // сказать это словами: итог и разбивка у такого отчёта могут не сходиться
    legacyCalc: Boolean(snapshot.legacy),
    frozenAt: snapshot.at,
  };
};

/**
 * Сходится ли снимок с суммами, которые отчёт уже хранит.
 *
 * Нужно один раз — отчётам, сформированным до появления снимка
 * (scripts/snapshotReports.js): снимок для них считается сегодня, и годится он,
 * только если даёт те же деньги. Расхождение значит, что услугу или работы
 * после формирования меняли, и нынешний расчёт — уже не тот, что подписан.
 * Копеечный шум двоичной арифметики расхождением не считается.
 */
const matchesStoredTotals = (snapshot, report) =>
  Math.abs((snapshot.price || 0) - (report.price || 0)) < 0.005 &&
  Math.abs((snapshot.additionalPrice || 0) - (report.additionalPrice || 0)) <
    0.005;

/**
 * Снимок старого отчёта, не сошедшегося с нынешним расчётом.
 *
 * Отчёты, сформированные до появления снимка, хранят только две суммы — их
 * видел клиент и по ним выставлен счёт. Условия услуги на тот день нигде не
 * записаны: цены с тех пор поднимали, правило округления меняли, и сегодняшний
 * расчёт по тем же работам даёт другие деньги. Правда документа — сохранённые
 * суммы, поэтому они и остаются итогом. Разбивка по работам и условия берутся
 * сегодняшние (другим взяться неоткуда) и больше не меняются; снимок помечен
 * `legacy`, чтобы карточка назвала расхождение, а не выдавала его за сбой.
 */
const pinToStored = (snapshot, report) => {
  const price = report.price || 0;
  const additionalPrice = report.additionalPrice || 0;
  return {
    ...snapshot,
    price,
    additionalPrice,
    total: Math.round((price + additionalPrice) * 100) / 100,
    legacy: true,
  };
};

module.exports = {
  buildSnapshot,
  cardFromSnapshot,
  matchesStoredTotals,
  pinToStored,
};
