// Интерактивная оболочка RouterOS поверх ssh2 (conn.shell): запись команд и
// ожидание вывода по шаблону. Нужна для safe mode — он живёт только в
// интерактивной сессии (Ctrl+X), в exec его нет.

// Суффикс консоли RouterOS: ct — без цветов, 200w — ширина 200 колонок,
// терминал не определяется (нет escape-последовательностей в выводе)
const shellLogin = (user) => `${user}+ct200w`;

const openShell = (conn, { cols = 200, rows = 50, openTimeoutMs = 15000 } = {}) =>
  new Promise((resolve, reject) => {
    // conn.shell может не ответить вовсе: без таймаута вызывающий повиснет
    let timedOut = false;
    const openTimer = setTimeout(() => {
      timedOut = true;
      reject(new Error("shell open timeout"));
    }, openTimeoutMs);

    conn.shell({ term: "dumb", cols, rows }, (error, stream) => {
      clearTimeout(openTimer);
      if (timedOut) {
        // Опоздавший поток никому не нужен — рвём
        stream?.destroy();
        return;
      }
      if (error) return reject(error);

      let buffer = "";
      let waiter = null;

      // Проверка накопителя: совпало — отдать текст до конца совпадения
      const settle = () => {
        if (!waiter) return;
        const match = waiter.until.exec(buffer);
        if (!match) return;
        const end = match.index + match[0].length;
        const text = buffer.slice(0, end);
        buffer = buffer.slice(end);
        clearTimeout(waiter.timer);
        const { resolve: done } = waiter;
        waiter = null;
        done(text);
      };

      stream.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        settle();
      });
      // Смерть потока (сброс TCP, обрыв транзита, ошибка SSH): isOpen() → false, подписчики — один раз
      let open = true;
      const listeners = [];
      const died = () => {
        if (!open) return;
        open = false;
        for (const cb of listeners.splice(0)) cb();
      };
      stream.on("error", died);
      stream.on("close", died);
      stream.on("end", died);

      resolve({
        write: (text) => stream.write(text),
        // Таймаут оставляет накопитель нетронутым: drain() покажет полученное
        read: ({ until, timeoutMs = 10000 }) =>
          new Promise((done, fail) => {
            waiter = {
              until,
              resolve: done,
              timer: setTimeout(() => {
                waiter = null;
                fail(new Error("shell read timeout"));
              }, timeoutMs),
            };
            settle();
          }),
        // Забрать всё накопленное (после таймаута — посмотреть, что пришло)
        drain: () => {
          const text = buffer;
          buffer = "";
          return text;
        },
        // Обрыв, а не выход: без quit
        close: () => {
          try {
            stream.destroy();
          } finally {
            died();
          }
        },
        isOpen: () => open,
        onClose: (cb) => {
          if (open) listeners.push(cb);
          else cb();
        },
      });
    });
  });

module.exports = { openShell, shellLogin };
