// Отказы от предложения чек-листа. Храним на клиенте: отказ персональный,
// ничего не решает и не стоит запроса к серверу — но переживать перезагрузку
// обязан, иначе строка всплывает снова на каждое F5 и превращается в рекламу.
//
// Держим только последние номера: список растёт по одному на отказ, а заявок
// за год три тысячи.

const KEY = "checklistOfferDismissed";
const LIMIT = 300;

const read = () => {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const isOfferDismissed = (ticketNum) =>
  read().includes(Number(ticketNum));

export const dismissOffer = (ticketNum) => {
  const num = Number(ticketNum);
  const next = [num, ...read().filter((item) => item !== num)].slice(0, LIMIT);

  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Приватный режим или переполнение — предложение просто вернётся позже
  }
};
