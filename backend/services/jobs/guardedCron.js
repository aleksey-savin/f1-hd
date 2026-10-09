/**
 * Крон-задания бэкенда: замок «не больше одного прогона», сторож долгого
 * прогона и мягкая остановка.
 *
 * Раньше сторож снимал замок по таймауту: `Promise.race([run(), watchdog])`
 * отпускал `inFlight`, а зависший прогон продолжал работать, и следующий тик
 * запускал второй поверх первого — очередь писем, например, разбиралась двумя
 * прогонами сразу. Теперь сторож только пишет ошибку в журнал, а замок
 * держится, пока прогон действительно не закончится.
 *
 * Остановка: `stopAll` гасит расписания (новых прогонов не будет), `drain`
 * ждёт идущие — не дольше заданного срока — и называет те, что не успели.
 *
 * Расписание, журнал и готовность базы приходят параметрами: тест подставляет
 * свои и крутит тики руками.
 *
 * @param {object} deps
 * @param {(expression: string, tick: () => void, options?: object) => { stop: () => void }} deps.schedule
 *   `cron.schedule` из node-cron
 * @param {(level: string, message: string, meta?: object) => void} deps.log
 * @param {() => boolean} deps.isDbReady прогоны без базы не запускаются
 */
const createCronRegistry = ({ schedule, log, isDbReady }) => {
  const tasks = [];
  // Идущие прогоны: промис → имя задания
  const inFlight = new Map();
  let stopped = false;

  // run() может и бросить синхронно, и вернуть не-промис
  const invoke = (run) => {
    try {
      return Promise.resolve(run());
    } catch (error) {
      return Promise.reject(error);
    }
  };

  /**
   * @param {string} name имя в журнале
   * @param {string} expression выражение node-cron
   * @param {() => unknown} run тело задания
   * @param {number} timeoutMs через сколько прогон считается зависшим; 0 — без сторожа
   * @param {{ quietSkip?: boolean, timezone?: string }} [options]
   *   quietSkip — пропуск тика из-за идущего прогона пишется на уровне debug
   *   (задание, которое штатно переживает свой интервал); timezone — пояс
   *   расписания для node-cron
   */
  const register = (
    name,
    expression,
    run,
    timeoutMs,
    { quietSkip = false, timezone } = {},
  ) => {
    let current = null;

    const tick = () => {
      if (stopped) return;
      if (current) {
        log(
          quietSkip ? "debug" : "warn",
          `Skipping ${name}: previous run is still active`,
        );
        return;
      }
      if (!isDbReady()) return;

      const watchdog =
        timeoutMs > 0
          ? setTimeout(() => {
              log(
                "error",
                `${name} watchdog timeout: still running after ${timeoutMs} ms, next runs wait for it`,
              );
            }, timeoutMs)
          : null;

      const settled = invoke(run)
        .catch((error) => {
          log("error", `${name} run failed`, { error: error?.message });
        })
        .finally(() => {
          if (watchdog) clearTimeout(watchdog);
          inFlight.delete(settled);
          current = null;
        });

      current = settled;
      inFlight.set(settled, name);
    };

    tasks.push(schedule(expression, tick, timezone ? { timezone } : undefined));
  };

  /** Погасить все расписания; тик, пришедший после, ничего не запустит. */
  const stopAll = () => {
    stopped = true;
    for (const task of tasks) task.stop();
  };

  /**
   * Дождаться идущих прогонов, но не дольше `timeoutMs`.
   *
   * @returns {Promise<string[]>} имена заданий, которые к сроку не закончились
   */
  const drain = async (timeoutMs) => {
    let timer;
    const deadline = new Promise((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    });
    await Promise.race([Promise.all(inFlight.keys()), deadline]);
    clearTimeout(timer);
    return [...inFlight.values()];
  };

  return { register, stopAll, drain };
};

module.exports = { createCronRegistry };
