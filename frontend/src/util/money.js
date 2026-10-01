// Деньги с копейками — для того, что ЗАДАЁТСЯ руками: ставки и цены услуги.
// Чистый модуль (грузится в node --test).
//
// Суммы отчётов сюда не относятся: они показываются целыми рублями
// (Report/work-format → formatMoney). Копейки нужны там, где цену вводят и
// сверяют с договором, — в форме услуги и в её условиях.

const SPACES = /[\s\u00a0\u202f]/g;

const toKopecks = (value) => Math.round(value * 100) / 100;

/**
 * Число из поля ввода: «1 250,5», «1250.50», 1250.5 → 1250.5.
 * Пустое и нечисловое — 0; отрицательных цен не бывает; точнее копейки сумма
 * не хранится.
 */
export const parseMoney = (value) => {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? toKopecks(value) : 0;
  }
  const number = Number(
    String(value ?? "")
      .replace(SPACES, "")
      .replace(",", "."),
  );
  return Number.isFinite(number) && number > 0 ? toKopecks(number) : 0;
};

const grouped = (number) =>
  number.toLocaleString("ru-RU", {
    minimumFractionDigits: Number.isInteger(number) ? 0 : 2,
    maximumFractionDigits: 2,
  });

/**
 * Значение для поля ввода: «1 250,50», а целое — «1 250». Разряды — обычным
 * пробелом: неразрывный в поле не отличить глазом и не стереть привычным
 * способом.
 */
export const moneyInputValue = (value) =>
  grouped(parseMoney(value)).replace(SPACES, " ");

/** Сумма для показа как задана: «1 250,50 ₽», целая — «120 000 ₽». */
export const formatMoneyExact = (value) =>
  `${grouped(parseMoney(value)).replace(SPACES, "\u00a0")}\u00a0₽`;
