// Разовая проверка safe mode RouterOS на живом роутере (2026-10-10).
//
// Выясняет, откатывает ли safe mode, удерживаемый SSH-оболочкой, изменения,
// сделанные ОТДЕЛЬНОЙ API-сессией (так будет работать исполнитель правок HD:
// оболочка только держит safe mode, команды идут через API). Сценарий:
//   0. проверка: список адресов `hd-probe` пуст (иначе выход, роутер не тронут);
//   1. оболочка, Ctrl+X (safe mode взят), API add записи в `hd-probe`
//      (список нигде не используется — на трафик не влияет) + дубликат ради
//      образца текста ошибки, count пока safe mode держится;
//   2. обрыв оболочки (без выхода), через 5 с (+15 с) count: 0 — откат (rollback);
//   3. при откате: снова оболочка, Ctrl+X, API add, Ctrl+X (штатный выход),
//      обрыв; count >= 1 — запись сохранилась (keep). Перед вторым Ctrl+X
//      накопленный вывод оболочки печатается; если в нём перехват или чужое
//      снятие/взятие safe mode — клавиша не шлётся, keep=UNKNOWN;
//   4. уборка записей списка и повторная проверка через 30 с.
// В интерактивную оболочку пишутся ТОЛЬКО `\x18` (Ctrl+X) и, при попытке
// перехвата чужого safe mode, одна буква `d` (отказ). Команды в консоль не
// набираются, `quit` не шлётся: оболочку всегда завершает обрыв (destroy).
//
// Перед запуском: делать, когда роутер никто больше не настраивает — safe mode
// общий на весь роутер: пока он держится, обрыв сессии откатит и чужие правки
// этого окна.
//   - Запускать из терминала, который не оборвётся (tmux/screen): при обрыве
//     терминала скрипт уберёт за собой, но предупреждение некому будет прочесть.
//   - Код выхода 0 значит только «проверка перед стартом пройдена и список
//     пуст»; вердикты — в строке `SAFE MODE:`, читать её.
//   - Через несколько минут после ЛЮБОГО запуска проверить список руками:
//       /ip firewall address-list print where list=hd-probe
// Тексты консоли и суффикс логина `+ct200w` из документации и не проверены:
// скрипт печатает сырой вывод (JSON.stringify) и не падает на несовпадении.
//
// Без --apply ничего не открывает: только печатает план.
//
// Запуск внутри контейнера бэкенда:
//   node scripts/spikeSafeMode.js <recordId>            # показать план
//   node scripts/spikeSafeMode.js <recordId> --apply    # прогнать
// Код выхода: 0 — проверка пройдена и после уборки список пуст (это не вердикт,
// вердикты в строке `SAFE MODE:`); иначе 1.
require("module-alias/register");
const mongoose = require("mongoose");

const Mikrotik = require("@/models/mikrotik");
const { resolveJumpContext, pollParams } = require("@/services/mikrotik/monitorState");
const { assertPublicHost, assertJumpTargetHost } = require("@/services/mikrotik/hostGuard");
const {
  buildSshParams,
  openSshSession,
  withSshSession,
  withApiSession,
  sshExec,
} = require("@/services/mikrotik/connector");
const { openShell, shellLogin } = require("@/services/mikrotik/sshShell");

const LIST = "hd-probe";
const CTRL_X = "\x18";
// Приглашение обычное `[user@id] > ` и safe mode `[user@id] <SAFE>`
const PROMPT = /\][^\r\n]*> ?$/;
// Чужой safe mode: Ctrl+X спрашивает [u/r/d]; ответ набирать нельзя, кроме `d`
const HIJACK = /Hijack|\[u\/r\/d\]/i;
const TAKEN = /Safe Mode taken|<SAFE>/i;
const RELEASED = /Safe Mode released/i;
// В накопленном до выхода выводе: safe mode сняли или взяли без нас. Только
// тексты, которые может породить ЧУЖАЯ сессия: наш собственный «Safe Mode
// taken» (если приглашение пришло раньше текста) совпадать не должен
const LOST = /safe mode[^\r\n]*(released|unrolled)|another user|Hijack|\[u\/r\/d\]/i;
// Самопроверка шаблона LOST (у скрипта нет юнит-тестов): печатается в плане
const LOST_SAMPLES = [
  [" [Safe Mode taken]\r\n[admin@R] <SAFE> ", false],
  [" \r\n[Safe Mode taken]\r\n[admin@R] <SAFE> ", false],
  ["]\r\n[admin@R] <SAFE> ", false],
  ["", false],
  ["[Safe mode released by another user]", true],
  ["[Safe Mode released]", true],
  ["[Safe mode unrolled by another user]", true],
  ["[Safe Mode taken by another user]", true],
  ["Hijack Safe Mode from someone - unroll/release/dont take it [u/r/d]:", true],
];
const lostSelfCheck = () => LOST_SAMPLES.filter(([text, want]) => LOST.test(text) !== want);
const READ_MS = 15000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const show = (label, text) => console.log(`  ${label}: ${JSON.stringify(text)}`);

const countCommand = `/ip firewall address-list print count-only where list=${LIST}`;

// Число записей пробы свежей exec-сессией; null — не удалось прочитать
const countProbe = async (params) => {
  try {
    const { result } = await withSshSession(params, (conn) => sshExec(conn, countCommand));
    const text = result.toString("utf8");
    show("count", text);
    const n = Number.parseInt(text.trim(), 10);
    return Number.isNaN(n) ? null : n;
  } catch (error) {
    console.log(`  count: ошибка ${error.message}`);
    return null;
  }
};

// Прерывание: после установки флага новые сессии и добавления не начинаются
let aborting = false;
const assertNotAborting = () => {
  if (aborting) throw new Error("aborting");
};

// Открытые интерактивные сессии: закрываются при прерывании до уборки
const openHandles = new Set();
const dropHandle = (handle) => {
  openHandles.delete(handle);
  try {
    handle.shell?.close();
  } catch {}
  try {
    handle.session.close();
  } catch {}
};
const openProbeShell = async (shellParams) => {
  assertNotAborting();
  const session = await openSshSession(shellParams);
  const handle = { session, shell: null };
  if (aborting) {
    dropHandle(handle);
    throw new Error("aborting");
  }
  openHandles.add(handle);
  try {
    handle.shell = await openShell(session.conn, {});
  } catch (error) {
    dropHandle(handle);
    throw error;
  }
  return handle;
};

// Ctrl+X с проверкой ответа. Единственные байты в оболочку: \x18 и `d`.
// Возврат: "ok" | "BUSY" (чужой safe mode, отказались) | "UNKNOWN"
const pressCtrlX = async (handle, { entering }) => {
  const expected = entering ? TAKEN : RELEASED;
  handle.shell.write(CTRL_X);
  let text = "";
  try {
    text = await handle.shell.read({
      until: new RegExp(`${HIJACK.source}|${expected.source}`, "i"),
      timeoutMs: 10000,
    });
  } catch (error) {
    text = handle.shell.drain();
    console.log(`  [${error.message}] после Ctrl+X ничего подходящего не пришло`);
  }
  show("ответ на Ctrl+X", text);
  if (HIJACK.test(text)) {
    handle.shell.write("d");
    console.log("  перехват чужого safe mode: отправлено d (отказ), дальше не идём");
    return "BUSY";
  }
  if (expected.test(text)) return "ok";
  console.log(
    `  ожидали ${expected} или ${HIJACK}; получено выше — ничего больше не шлём (UNKNOWN)`,
  );
  return "UNKNOWN";
};

// Штатный выход из safe mode. Сначала печатаем накопленное с момента входа:
// иначе чужое уведомление было бы принято за ответ на нашу клавишу. Если в нём
// перехват или чужое снятие/взятие — клавишу не шлём. Возврат как у pressCtrlX
// плюс "LOST". Между drain и записью \x18 нет await — окна для нового текста нет
const releaseSafeMode = (handle) => {
  const pending = handle.shell.drain();
  show("накоплено до выхода", pending);
  if (LOST.test(pending)) {
    console.log(`  в накопленном совпал ${LOST}: safe mode уже не наш — Ctrl+X не шлём`);
    return Promise.resolve("LOST");
  }
  console.log("  Ctrl+X (выход)");
  return pressCtrlX(handle, { entering: false });
};

// Оболочка берёт safe mode. Возврат { handle, state }: state "ok" — удерживаем мы
const holdSafeMode = async (shellParams) => {
  const handle = await openProbeShell(shellParams);
  console.log("  ждём приглашение");
  try {
    show("приглашение", await handle.shell.read({ until: PROMPT, timeoutMs: READ_MS }));
  } catch (error) {
    show(`приглашение [${error.message}] получено`, handle.shell.drain());
    console.log(`  приглашение ${PROMPT} не дождались — ничего не шлём (UNKNOWN)`);
    dropHandle(handle);
    return { handle: null, state: "UNKNOWN" };
  }
  console.log("  Ctrl+X (safe mode), в консоль ничего не набираем");
  const state = await pressCtrlX(handle, { entering: true });
  if (state !== "ok") {
    dropHandle(handle);
    return { handle: null, state };
  }
  // Хвост собственного ответа (приглашение, «Safe Mode taken» в любом порядке)
  // забираем сейчас, чтобы он не дошёл до проверки перед выходом
  await sleep(500);
  const tail = handle.shell.drain();
  show("хвост после входа", tail);
  if (LOST.test(tail)) {
    console.log(`  в хвосте совпал ${LOST}: safe mode уже не наш — дальше не идём (UNKNOWN)`);
    dropHandle(handle);
    return { handle: null, state: "UNKNOWN" };
  }
  return { handle, state };
};

// Отдельная API-сессия: add записи пробы; dup — ещё и дубликат ради образца
// ошибки. Печатаются только строки ответа и error.message (пароль не попадает).
// Возврат: удался ли основной add
const apiAdd = async (apiParams, { dup = false } = {}) => {
  assertNotAborting();
  const words = [
    "/ip/firewall/address-list/add",
    `=list=${LIST}`,
    "=address=192.0.2.3",
    "=comment=hd-safe-mode-probe-api",
  ];
  let added = false;
  try {
    await withApiSession(
      apiParams,
      async (run) => {
        // Прерывание могло прийти, пока сессия подключалась: после уборки не добавляем
        assertNotAborting();
        show("api add", await run(words));
        added = true;
        if (dup) {
          // Вне try: прерывание — не «ошибка дубликата», оно уходит наверх
          assertNotAborting();
          try {
            show("api дубликат (ожидалась ошибка, но принят)", await run(words));
          } catch (error) {
            show("api дубликат, ошибка", error.message);
          }
        }
      },
      { deadlineMs: 30000 },
    );
  } catch (error) {
    if (aborting) throw error;
    console.log(`  API-сессия: ${error.message}`);
  }
  return added;
};

// Ждём откат после обрыва: 5 с, при ненулевом — ещё 15 с
const awaitRollback = async (execParams) => {
  await sleep(5000);
  let n = await countProbe(execParams);
  if (n !== 0) {
    // Роутер мог ещё не заметить обрыв — даём время и смотрим ещё раз
    console.log("  не 0, ждём 15 с и смотрим повторно");
    await sleep(15000);
    n = await countProbe(execParams);
  }
  return n;
};

const removeProbe = async (execParams) => {
  // Удаляем по имени списка: это безопасно только потому, что перед стартом
  // скрипт убедился, что список hd-probe пуст, — чужих записей в нём нет
  try {
    const { result } = await withSshSession(execParams, (conn) =>
      sshExec(conn, `/ip firewall address-list remove [find where list=${LIST}]`),
    );
    show("remove", result.toString("utf8"));
  } catch (error) {
    console.log(`  удаление не удалось: ${error.message}`);
  }
};

const run = async () => {
  const recordId = process.argv[2];
  const apply = process.argv.includes("--apply");
  if (!recordId || recordId.startsWith("--")) {
    console.error("Использование: node scripts/spikeSafeMode.js <recordId> [--apply]");
    return 2;
  }

  if (!apply) {
    const wrong = lostSelfCheck();
    if (wrong.length > 0) {
      for (const [text, want] of wrong) {
        console.log(`self-check: FAILED — LOST должен дать ${want} на ${JSON.stringify(text)}`);
      }
      return 1;
    }
    console.log(`self-check: ok (шаблон LOST, ${LOST_SAMPLES.length} образцов)`);
    console.log(`План для записи ${recordId} (без --apply соединений не открываем):`);
    console.log(`  0. проверка: список ${LIST} пуст (иначе выход, роутер не тронут)`);
    console.log("Сценарий api (оболочка держит safe mode, add через отдельную API-сессию):");
    console.log("  1. оболочка, Ctrl+X; чужой safe mode ([u/r/d]) -> отказ `d`, BUSY; нет подтверждения -> UNKNOWN");
    console.log(`  2. API add записи в ${LIST} + дубликат ради образца ошибки; count при удержании (>= 1, иначе NOADD)`);
    console.log("  3. обрыв оболочки, через 5 с (+15 с) count: 0 — rollback=ok, не прочитан — UNKNOWN");
    console.log("  4. при откате: повтор, Ctrl+X, API add, Ctrl+X (выход), обрыв, count >= 1 — keep=ok");
    console.log("     выход не подтверждён текстом: count >= 1 — keep=ok?, 0 — UNKNOWN; чужой текст до выхода — Ctrl+X не шлём, UNKNOWN");
    console.log(`  5. уборка записей списка ${LIST}, через 30 с повторная проверка (ожидается 0; иначе ещё одна уборка)`);
    console.log("В оболочку пишутся только Ctrl+X и, при перехвате чужого safe mode, `d`.");
    console.log("Итог: SAFE MODE: api rollback=.. keep=.. (печатается на любом выходе после --apply)");
    return 0;
  }

  // Оборванный терминал: запись в него не должна ронять уборку
  process.stdout.on("error", () => {});
  process.stderr.on("error", () => {});

  let rollback = "NOT RUN";
  let keep = "NOT RUN";
  let execParams;
  // Чистить можно только после проверки, что список был пуст до нас
  let preflightOk = false;
  let leftover = false;

  // Итоговая строка — на любом выходе после --apply, один раз
  let resultPrinted = false;
  const printResult = () => {
    if (resultPrinted) return;
    resultPrinted = true;
    console.log(`SAFE MODE: api rollback=${rollback} keep=${keep}`);
  };

  const doCleanup = async () => {
    console.log("5. уборка");
    await removeProbe(execParams);
    // Сессия роутера, пережившая скрипт, могла откатить уборку: смотрим позже
    console.log("  ждём 30 с и проверяем ещё раз");
    await sleep(30000);
    let left = await countProbe(execParams);
    if (left !== 0) {
      // Запоздавший add (прерывание во время API-сессии) или откат уборки:
      // убираем ещё один раз и смотрим окончательно
      console.log("  не 0 — убираем ещё раз, ждём 5 с и смотрим окончательно");
      await removeProbe(execParams);
      await sleep(5000);
      left = await countProbe(execParams);
    }
    if (left === 0) console.log("  чисто");
    else {
      leftover = true;
      console.log(
        `ВНИМАНИЕ: в списке ${LIST} остались записи или он не читается (count=${left}) — проверить и удалить руками`,
      );
    }
  };
  // Одна уборка на всех: повторный вызов (сигнал во время уборки) ждёт ту же
  let cleanupPromise = null;
  const cleanup = () => {
    if (!preflightOk) return Promise.resolve();
    cleanupPromise ??= doCleanup();
    return cleanupPromise;
  };

  // Прерывание: флаг первым делом, затем рвём оболочки (safe mode снимет их
  // записи сам) и убираем
  const abort = async (reason) => {
    aborting = true;
    console.log(`\n${reason}: прерываем, убираем`);
    for (const handle of [...openHandles]) dropHandle(handle);
    try {
      await cleanup();
    } finally {
      try {
        printResult();
      } finally {
        process.exit(1);
      }
    }
  };
  // SIGHUP — оборванный терминал, SIGQUIT — Ctrl+\: тот же путь, что и Ctrl+C
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"]) {
    process.on(signal, () => abort(signal));
  }
  process.on("uncaughtException", (error) => abort(`uncaughtException ${error?.message}`));
  process.on("unhandledRejection", (error) => abort(`unhandledRejection ${error?.message}`));

  try {
    try {
      await mongoose.connect(
        `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
      );
    } catch (error) {
      // Текст ошибки драйвера не печатаем: в строке подключения пароль
      throw new Error(`MongoDB недоступна (${error?.name})`);
    }
    assertNotAborting();
    const record = await Mikrotik.findById(recordId);
    if (!record?.credentials?.host) throw new Error("Запись не найдена или без адреса");
    const jumpCtx = await resolveJumpContext(record);
    if (record.jumpRecordId) assertJumpTargetHost(record.credentials.host);
    else await assertPublicHost(record.credentials.host);

    execParams = { ...buildSshParams(record), jump: jumpCtx?.params };
    const shellParams = { ...execParams, user: shellLogin(execParams.user) };
    const apiParams = { ...pollParams(record), jump: jumpCtx?.params };

    console.log("0. проверка: список пуст");
    const before = await countProbe(execParams);
    if (before !== 0) {
      console.log(
        `ВНИМАНИЕ: список ${LIST} не пуст или не читается (count=${before}) ещё до запуска. Выходим, роутер не тронут.`,
      );
      return 1;
    }
    preflightOk = true;

    try {
      console.log("== api: откат при обрыве оболочки в safe mode ==");
      const first = await holdSafeMode(shellParams);
      if (first.state !== "ok") {
        rollback = first.state;
        keep = "SKIPPED";
      } else {
        const added = await apiAdd(apiParams, { dup: true });
        // Запись должна быть видна, пока safe mode ещё держится
        const heldCount = await countProbe(execParams);
        dropHandle(first.handle);
        if (!added || !(heldCount >= 1)) {
          rollback = "NOADD";
          keep = "SKIPPED";
          console.log("Запись не появилась при удержании safe mode — NOADD, keep пропускаем");
        } else {
          const n = await awaitRollback(execParams);
          // Счётчик не прочитан — неизвестность, а не провал отката
          rollback = n === 0 ? "ok" : n === null ? "UNKNOWN" : "FAILED";
          if (rollback !== "ok") {
            keep = "SKIPPED";
            console.log("Откат не подтверждён — keep пропускаем, сразу уборка");
          }
        }
      }

      assertNotAborting();
      if (rollback === "ok") {
        console.log("== api: штатный выход из safe mode ==");
        const second = await holdSafeMode(shellParams);
        if (second.state !== "ok") {
          keep = second.state;
        } else {
          const added = await apiAdd(apiParams);
          const heldCount = await countProbe(execParams);
          if (!added || !(heldCount >= 1)) {
            dropHandle(second.handle);
            keep = "NOADD";
            console.log("Запись не появилась при удержании safe mode — NOADD");
          } else {
            assertNotAborting();
            const state = await releaseSafeMode(second.handle);
            dropHandle(second.handle);
            if (state === "BUSY") keep = "BUSY";
            else if (state === "LOST") {
              keep = "UNKNOWN";
              console.log("  keep=UNKNOWN: выход из safe mode не выполнялся (см. накопленное выше)");
            } else {
              // Выход не подтверждён: обрыв мог откатить запись, а роутер замечает
              // обрыв не сразу — ждём как в фазе отката (5 с, при не-0 ещё 15 с)
              let kept;
              if (state === "ok") {
                await sleep(2000);
                kept = await countProbe(execParams);
              } else kept = await awaitRollback(execParams);
              const present = kept !== null && kept >= 1;
              if (state === "ok") {
                // Счётчик не прочитан — это не провал сохранения, а неизвестность
                keep = present ? "ok" : kept === 0 ? "FAILED" : "UNKNOWN";
              } else {
                keep = present ? "ok?" : "UNKNOWN";
                console.log(
                  `  выход из safe mode НЕ подтверждён: ожидали ${RELEASED}, получен сырой ответ на Ctrl+X выше; ` +
                    (present
                      ? "запись на месте — keep=ok? (сохранилась, но текст выхода не распознан)"
                      : "записи нет или счётчик не прочитан — keep=UNKNOWN"),
                );
              }
            }
          }
        }
      }
    } catch (error) {
      console.log(`Ошибка сценария: ${error.message}`);
    }
  } catch (error) {
    console.log(`Ошибка подготовки: ${error.message}`);
  } finally {
    for (const handle of [...openHandles]) dropHandle(handle);
    await cleanup();
    printResult();
    try {
      await mongoose.disconnect();
    } catch {}
  }

  return preflightOk && !leftover && !aborting ? 0 : 1;
};

run()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
