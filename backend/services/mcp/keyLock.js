/**
 * Очередь на ключ: пока предыдущий вызов не закончил, следующий ждёт. Нужна
 * там, где проверка и запись должны идти без гонки (дубликат заголовка,
 * суточный предел). В памяти процесса — как и очередь запросов на изменение
 * Mikrotik (services/mikrotik/changeProposals.js).
 */
const createKeyLock = () => {
  const tails = new Map();
  return (key, fn) => {
    const run = (tails.get(key) || Promise.resolve()).then(fn);
    const tail = run.catch(() => {});
    tails.set(key, tail);
    tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return run;
  };
};

module.exports = { createKeyLock };
