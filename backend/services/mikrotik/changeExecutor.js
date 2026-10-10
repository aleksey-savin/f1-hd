// Исполнитель одобренных правок. Единственный код фичи, который пишет в боевой роутер.
// Предложения API приходят готовыми (apiWords) и не меняются. В режиме safe-mode SSH-оболочка
// только ДЕРЖИТ safe mode: в неё пишутся лишь Ctrl+X (\x18) и `d`; команды идут отдельной
// API-сессией, при любом сбое оболочка просто обрывается и роутер откатывает правки сам.
// Режим api — без safe mode и без отката. Весь ввод-вывод внедряется.
const { PROMPT, ENTER_UNTIL, RELEASE_UNTIL, classifyCtrlX, lostSafeMode } = require("./safeModeConsole");

const CTRL_X = "\x18";
const DECLINE = "d";
const DEFAULT_LIMITS = { commandMs: 15000, totalMs: 120000, replyMs: 10000, settleMs: 5000 };
// Пауза после входа: [Safe Mode taken] может прийти позже приглашения <SAFE>
const TAKEN_SETTLE_MS = 500;
const MAX_ERROR = 300;

const FAILURES = {
  held: "safe mode is held by another session",
  unconfirmed: "could not confirm safe mode",
  unconfirmedTimeout: "timed out; could not confirm safe mode",
  silent: "the device stopped answering after the change",
  lost: "safe mode was taken over by another session; applied commands may remain",
  lostOnEntry: "safe mode was taken over by another session",
  lostBeforeRelease: "safe mode was taken over by another session before release; applied commands may remain",
  releaseUnknown: "release of safe mode was not confirmed; the router may have rolled the change back",
  sessionLost: "the safe mode session was lost; the router rolls the change back",
  probeTimeout: "timed out while checking the device after the change; safe mode was dropped and the router rolls the change back",
  noCommand: "timed out before any command was sent",
  lostBeforeCommand: "the safe mode session was lost before any command was sent",
  sessionEnded: "the API session ended before all commands were sent",
};
// Тексты и префиксы, по которым воркер распознаёт исход; менять только вместе с changeWorker
const TEXTS = Object.freeze({
  timedOut: "timed out",
  notConfirmed: "not confirmed",
  openConsole: "could not open a console session",
  openApi: "could not open the API session",
  upgrading: "The device is being upgraded",
});
const ROLLS_BACK = "safe mode was dropped and the router rolls the change back";

class DeadlineError extends Error {}
class CommandTimeout extends Error {}
class HoldLost extends Error {}

// Текст ошибки роутера: одна строка, не длиннее MAX_ERROR
const oneLine = (error) =>
  String(error?.message ?? error ?? "error")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_ERROR) || "error";

const withTimeout = (promise, ms) => {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new CommandTimeout(TEXTS.timedOut)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

const createExecutor = ({ mode = "safe-mode", limits, openHold, runApi, probe, sleep, log, now } = {}) => {
  if (mode !== "safe-mode" && mode !== "api") throw new Error(`unknown executor mode: ${mode}`);
  const lim = { ...DEFAULT_LIMITS, ...limits };
  void log;
  void now;

  const applyCommands = async (record, items) => {
    // Общий дедлайн: within() прерывает ожидание, а не саму работу, поэтому после него state.stopped
    let deadlineTimer;
    const deadline = new Promise((_, reject) => {
      deadlineTimer = setTimeout(() => reject(new DeadlineError(TEXTS.timedOut)), lim.totalMs);
    });
    deadline.catch(() => {});
    const within = (promise) => Promise.race([promise, deadline]);

    const total = items.length;
    const state = { stopped: false };
    const ctx = { ok: 0, sentCount: 0, current: null, error: null, lost: false, deadline: false, sessionError: null, holdLost: false, unexpected: null };
    const skipped = () => items.map(() => ({ state: "skipped", error: null }));
    const mark = (count, doneState) =>
      items.map((_, i) => ({ state: i < count ? doneState : "skipped", error: null }));
    const finish = async (results, { rolledBack = false, failure = null, releaseConfirmed = false, settle = false } = {}) => {
      if (settle) {
        try {
          await sleep(lim.settleMs);
        } catch {
          // пауза необязательна
        }
      }
      let reachable;
      try {
        reachable = Boolean(await withTimeout(probe(record), lim.commandMs));
      } catch {
        reachable = false;
      }
      return { executor: mode, results, rolledBack, reachable, failure, releaseConfirmed };
    };

    const isTimeout = () => ctx.deadline || ctx.error instanceof CommandTimeout;
    // Состояния по итогам прогона: ok выполненных, текущая — failed, остальные skipped
    const outcome = (doneState, currentText) => {
      const results = mark(ctx.ok, doneState);
      if (ctx.current !== null) {
        results[ctx.current] = {
          state: "failed",
          error: currentText ?? (isTimeout() ? TEXTS.timedOut : oneLine(ctx.error ?? ctx.sessionError)),
          // refused: роутер ответил !trap — команда точно не выполнилась; обрыв и таймаут таким не считаются
          ...(currentText === undefined && ctx.error?.trap === true ? { refused: true } : {}),
        };
      }
      return results;
    };
    // runApi вернулась раньше времени: ушедшая и не подтверждённая правка не skipped — она могла примениться
    const incomplete = (doneState) => {
      const results = mark(ctx.ok, doneState);
      if (ctx.current !== null) results[ctx.current] = { state: "failed", error: TEXTS.notConfirmed };
      return results;
    };
    const incompleteFailure = () =>
      ctx.current !== null
        ? `the API session ended before command ${ctx.current + 1} was confirmed; it may have been applied`
        : FAILURES.sessionEnded;
    const failed = () => Boolean(ctx.error || ctx.deadline || ctx.sessionError);

    // fn для API-сессии: первым делом проверка stop, перед каждой записью — тоже.
    // holdUsable() — оболочка жива (в режиме api не используется); death — отказ при её смерти
    // Каждая правка уходит не больше одного раза: повторный вызов fn ничего не шлёт
    const makeWork = ({ hold, holdUsable, death, closeHold }) => {
      let invoked = false;
      return async (run) => {
      if (invoked || state.stopped) return;
      invoked = true;
      for (let i = 0; i < items.length; i += 1) {
        if (state.stopped) return;
        if (hold) {
          try {
            // drain раньше проверки: оболочка могла умереть, пока читали накопленное
            const pending = hold.drain();
            if (!holdUsable()) {
              ctx.holdLost = true;
              return;
            }
            if (lostSafeMode(pending)) {
              ctx.lost = true;
              return;
            }
          } catch (error) {
            ctx.unexpected = error;
            state.stopped = true;
            return;
          }
        }
        ctx.current = i;
        ctx.sentCount += 1;
        try {
          const sent = withTimeout(run(items[i].words), lim.commandMs);
          await (death ? Promise.race([sent, death]) : sent);
        } catch (error) {
          state.stopped = true;
          if (error instanceof HoldLost) ctx.holdLost = true;
          else ctx.error = error;
          closeHold();
          return;
        }
        if (state.stopped) return;
        if (hold && !holdUsable()) {
          // ответ пришёл, но safe mode уже нет: правка откатится
          ctx.holdLost = true;
          state.stopped = true;
          return;
        }
        ctx.current = null;
        ctx.ok = i + 1;
      }
      };
    };

    const runPhase = async (work, death) => {
      try {
        // Смерть оболочки обрывает и подключение API-сессии, не дожидаясь дедлайна
        const session = runApi(record, work);
        await within(death ? Promise.race([session, death]) : session);
      } catch (error) {
        state.stopped = true;
        if (error instanceof DeadlineError) ctx.deadline = true;
        else if (error instanceof HoldLost) ctx.holdLost = true;
        else ctx.sessionError = error;
      }
      // После возврата runApi новых записей быть не должно, даже если fn ещё не закончила
      state.stopped = true;
    };

    try {
      if (mode === "api") {
        await runPhase(makeWork({ closeHold: () => {} }));
        const results = outcome("done");
        let failure = null;
        if (ctx.sessionError && ctx.sentCount === 0) failure = `${TEXTS.openApi}: ${oneLine(ctx.sessionError)}`;
        else if (ctx.deadline) failure = `timed out; ${ctx.ok} of ${total} commands were applied`;
        else if (ctx.error instanceof CommandTimeout) failure = `command ${ctx.current + 1} timed out; earlier commands stay applied`;
        else if (ctx.error) failure = `command ${ctx.current + 1} failed: ${oneLine(ctx.error)}; earlier commands stay applied`;
        else if (ctx.sessionError && ctx.current === null && ctx.ok === total) {
          failure = `the API session failed after the commands were sent: ${oneLine(ctx.sessionError)}`;
        } else if (ctx.sessionError && ctx.current === null) {
          failure = `the API session failed after ${ctx.ok} of ${total} commands: ${oneLine(ctx.sessionError)}; earlier commands stay applied`;
        } else if (ctx.sessionError) failure = `command ${ctx.current + 1} failed: ${oneLine(ctx.sessionError)}; earlier commands stay applied`;
        else if (ctx.ok !== total) {
          // runApi вернулась, не доведя fn до конца: ушедшая, но не подтверждённая правка — failed
          return await finish(incomplete("done"), { failure: incompleteFailure() });
        }
        return await finish(results, { failure });
      }

      // ---- safe-mode ----
      const opening = Promise.resolve().then(() => openHold(record));
      let hold;
      try {
        hold = await within(opening);
      } catch (error) {
        opening.then((late) => late?.close?.(), () => {});
        const text = error instanceof DeadlineError ? TEXTS.timedOut : oneLine(error);
        return await finish(skipped(), { failure: `${TEXTS.openConsole}: ${text}` });
      }

      let closed = false;
      let closedByUs = false;
      let dead = false;
      let onDead;
      const death = new Promise((_, reject) => {
        onDead = () => reject(new HoldLost("hold lost"));
      });
      death.catch(() => {});
      const close = () => {
        if (closed) return;
        closed = true;
        closedByUs = true;
        try {
          hold.close();
        } catch {
          // оболочка уже закрыта
        }
      };
      try {
        hold.onClose(() => {
          if (closedByUs) return;
          dead = true;
          state.stopped = true;
          onDead();
        });
      } catch {
        dead = true;
        state.stopped = true;
      }
      const holdUsable = () => !dead && !closed && hold.isOpen();
      // Единственная точка записи в оболочку: в неживую ничего не пишем
      const send = (text) => {
        if (!holdUsable()) throw new HoldLost("hold lost");
        hold.write(text);
      };
      const guard = (promise) => within(Promise.race([promise, death]));
      // Ответ консоли; на таймаут чтения — то, что успело прийти
      const readReply = async (until) => {
        try {
          return await guard(hold.read({ until, timeoutMs: lim.replyMs }));
        } catch (error) {
          if (error instanceof DeadlineError || error instanceof HoldLost) throw error;
          return hold.drain();
        }
      };

      const bail = async (failure) => {
        close();
        return await finish(skipped(), { failure });
      };
      let phase = "setup";
      let afterTaken = false;
      try {
        try {
          let prompt = true;
          try {
            await guard(hold.read({ until: PROMPT, timeoutMs: lim.replyMs }));
          } catch (error) {
            if (error instanceof DeadlineError || error instanceof HoldLost) throw error;
            prompt = false;
          }
          if (!prompt) return await bail(FAILURES.unconfirmed);
          send(CTRL_X);
          const entered = classifyCtrlX(await readReply(ENTER_UNTIL), { entering: true });
          if (entered === "busy") {
            try {
              send(DECLINE);
            } catch {
              // оболочка умерла: отказывать некому, safe mode не наш
            }
            return await bail(FAILURES.held);
          }
          if (entered !== "taken") return await bail(FAILURES.unconfirmed);
          // Собственные остатки входа не должны попасть в проверку между командами
          afterTaken = true;
          await guard(sleep(TAKEN_SETTLE_MS));
          if (lostSafeMode(hold.drain())) return await bail(FAILURES.lostOnEntry);
        } catch (error) {
          if (error instanceof DeadlineError) {
            return await bail(afterTaken ? FAILURES.noCommand : FAILURES.unconfirmedTimeout);
          }
          if (error instanceof HoldLost) return await bail(afterTaken ? FAILURES.lostBeforeCommand : FAILURES.unconfirmed);
          throw error;
        }

        phase = "run";
        await runPhase(makeWork({ hold, holdUsable, death, closeHold: close }), death);
        if (ctx.unexpected) throw ctx.unexpected;

        // Без Ctrl+X: обрыв оболочки откатывает правки
        const dropped = async (results, failure, rolledBack) => {
          close();
          return await finish(results, { rolledBack, failure, settle: true });
        };
        const touched = ctx.ok > 0 || ctx.current !== null;
        if (ctx.holdLost || (!ctx.lost && !failed() && !holdUsable())) {
          if (ctx.sentCount === 0) return await dropped(skipped(), FAILURES.lostBeforeCommand, false);
          return await dropped(outcome("rolled_back", "the safe mode session was lost"), FAILURES.sessionLost, true);
        }
        if (ctx.lost) return await dropped(mark(ctx.ok, "done"), FAILURES.lost, false);
        if (failed()) {
          const n = (ctx.current ?? ctx.ok) + 1;
          let failure;
          if (ctx.sessionError && ctx.current === null && ctx.ok === total) {
            failure = `the API session failed after the commands were sent: ${oneLine(ctx.sessionError)}`;
          } else if (ctx.sessionError && ctx.current === null) {
            failure = touched
              ? `the API session failed after ${ctx.ok} of ${total} commands: ${oneLine(ctx.sessionError)}; ${ROLLS_BACK}`
              : `${TEXTS.openApi}: ${oneLine(ctx.sessionError)}`;
          } else if (ctx.deadline && !touched) failure = FAILURES.noCommand;
          else if (ctx.deadline && ctx.current === null) failure = `timed out after ${ctx.ok} of ${total} commands; ${ROLLS_BACK}`;
          else if (isTimeout()) failure = `command ${n} timed out; ${ROLLS_BACK}`;
          else failure = `command ${n} failed: ${oneLine(ctx.error ?? ctx.sessionError)}; ${ROLLS_BACK}`;
          return await dropped(outcome("rolled_back"), failure, touched);
        }

        if (ctx.ok !== total) {
          // runApi вернулась, не доведя fn до конца: без выхода, оболочку роняем
          return await dropped(incomplete("rolled_back"), incompleteFailure(), ctx.sentCount > 0);
        }

        let up = false;
        try {
          up = Boolean(await guard(probe(record)));
        } catch (error) {
          if (error instanceof DeadlineError) {
            return await dropped(mark(total, "rolled_back"), FAILURES.probeTimeout, true);
          }
          up = false;
        }
        if (!up) {
          if (!holdUsable()) return await dropped(mark(total, "rolled_back"), FAILURES.sessionLost, true);
          return await dropped(mark(total, "rolled_back"), FAILURES.silent, true);
        }

        // Между drain и записью Ctrl+X нет await: нового текста в окне не будет
        if (lostSafeMode(hold.drain())) return await dropped(mark(total, "done"), FAILURES.lost, false);
        if (!holdUsable()) return await dropped(mark(total, "rolled_back"), FAILURES.sessionLost, true);
        phase = "release";
        send(CTRL_X);
        let released = "unknown";
        try {
          released = classifyCtrlX(await readReply(RELEASE_UNTIL), { entering: false });
        } catch {
          released = "unknown";
        }
        const all = mark(total, "done");
        if (released === "released") {
          close();
          return { executor: mode, results: all, rolledBack: false, reachable: true, failure: null, releaseConfirmed: true };
        }
        if (released === "busy") {
          try {
            send(DECLINE);
          } catch {
            // оболочка умерла: отказывать некому
          }
        }
        return await dropped(all, released === "busy" ? FAILURES.lostBeforeRelease : FAILURES.releaseUnknown, false);
      } catch (error) {
        // Непредвиденное: оболочку закрываем в любом случае, наружу не бросаем
        close();
        let results;
        let rolledBack = false;
        if (phase === "setup") results = skipped();
        else if (phase === "release") results = mark(total, "done");
        else {
          results = mark(ctx.ok, "rolled_back");
          if (ctx.current !== null) results[ctx.current] = { state: "failed", error: oneLine(error) };
          rolledBack = ctx.ok > 0 || ctx.current !== null;
        }
        return await finish(results, { rolledBack, failure: `unexpected error while applying: ${oneLine(error)}`, settle: true });
      } finally {
        close();
      }
    } finally {
      state.stopped = true;
      clearTimeout(deadlineTimer);
    }
  };

  // releaseConfirmed в режиме api всегда true
  return {
    applyCommands: async (record, items) => {
      if (!Array.isArray(items) || items.length === 0) {
        // Нечего применять: ничего не открываем, состояние роутера только сообщаем
        let reachable = false;
        try {
          reachable = Boolean(await withTimeout(probe(record), lim.commandMs));
        } catch {
          reachable = false;
        }
        return { executor: mode, results: [], rolledBack: false, reachable, failure: "no commands to apply", releaseConfirmed: false };
      }
      const result = await applyCommands(record, items);
      return mode === "api" ? { ...result, releaseConfirmed: true } : result;
    },
  };
};

// Боевая обвязка: настоящий коннектор. Модули подключаются лениво — тесты исполнителя
// не тянут логгер и модели. Режим читает вызывающий из MIKROTIK_CHANGE_EXECUTOR.
const liveExecutor = ({ mode = "safe-mode", log } = {}) => {
  const { buildSshParams, openSshSession, withApiSession } = require("@/services/mikrotik/connector");
  const { openShell, shellLogin } = require("@/services/mikrotik/sshShell");
  const { resolveJumpContext, pollParams } = require("@/services/mikrotik/monitorState");
  const { assertPublicHost, assertJumpTargetHost } = require("@/services/mikrotik/hostGuard");
  const { isUpgrading } = require("@/services/mikrotik/upgradeGuard");

  // Те же стражи, что у других живых обращений (runOnDevice)
  const guarded = async (record) => {
    const jumpCtx = await resolveJumpContext(record);
    if (isUpgrading(record) || isUpgrading(jumpCtx?.doc)) {
      throw Object.assign(new Error(TEXTS.upgrading), { code: "MIKROTIK_LIVE_UPGRADING" });
    }
    if (record.jumpRecordId) assertJumpTargetHost(record.credentials.host);
    else await assertPublicHost(record.credentials.host);
    return jumpCtx;
  };

  const openHold = async (record) => {
    const jumpCtx = await guarded(record);
    const params = buildSshParams(record);
    // keepalive: смерть соединения держателя safe mode замечается за секунды
    const session = await openSshSession({
      ...params,
      user: shellLogin(params.user),
      jump: jumpCtx?.params,
      // По умолчанию выключено, смерть оболочки замечаем по событиям потока и соединения.
      // Только по MIKROTIK_CHANGE_KEEPALIVE=1: ssh2 считает лишь ответы на свои keepalive,
      // а отвечает ли на них RouterOS — не проверено; без ответа держатель умрёт через ~15 с
      // и роутер откатит все правки
      ...(process.env.MIKROTIK_CHANGE_KEEPALIVE === "1" ? { keepalive: { intervalMs: 5000, countMax: 2 } } : {}),
    });
    try {
      const shell = await openShell(session.conn, {});
      // Смерть соединения (а не только потока) тоже смерть оболочки
      for (const event of ["close", "error", "end"]) session.conn.on(event, () => shell.close());
      return {
        write: shell.write,
        read: shell.read,
        drain: shell.drain,
        isOpen: shell.isOpen,
        onClose: shell.onClose,
        close: () => {
          try {
            shell.close();
          } finally {
            session.close();
          }
        },
      };
    } catch (error) {
      session.close();
      throw error;
    }
  };

  const runApi = async (record, fn) => {
    const jumpCtx = await guarded(record);
    return withApiSession({ ...pollParams(record), jump: jumpCtx?.params }, fn, { deadlineMs: DEFAULT_LIMITS.totalMs });
  };

  const probe = async (record) => {
    try {
      const jumpCtx = await guarded(record);
      const rows = await withApiSession(
        { ...pollParams(record), jump: jumpCtx?.params },
        (run) => run(["/system/identity/print"]),
        { deadlineMs: DEFAULT_LIMITS.commandMs },
      );
      return Array.isArray(rows);
    } catch {
      return false;
    }
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  return createExecutor({ mode, openHold, runApi, probe, sleep, log, now: () => Date.now() });
};

module.exports = { createExecutor, liveExecutor, DEFAULT_LIMITS, FAILURES, TEXTS };
