require("module-alias/register");
const express = require("express");
const helmet = require("helmet");
const cron = require("node-cron");
const mongoose = require("mongoose");
const path = require("path");

const logger = require("./utils/logger");
const { redactUrl } = require("./helpers/redactUrl");
const storage = require("./services/storage");
const { errorResponse } = require("./middleware/errorHandling");
const {
  performanceMonitor,
  requestIdMiddleware,
  compressionMiddleware,
  initializeMonitoring,
} = require("./middleware/performance");

const { checkRoutineTasks } = require("./middleware/routineTasks");

const { internal, external, public } = require("./routes/index");

const { initAuth, authRequestHandler } = require("./auth/bootstrap");
const { authPathAllowList } = require("./middleware/authPathAllowList");

// Сколько обратных прокси стоит перед бэкендом. ЧИСЛО, не `true`:
// express-rate-limit@7 при `true` бросает ERR_ERL_PERMISSIVE_TRUST_PROXY и
// валит стартап. Ноль по умолчанию — сегодняшнее поведение (req.ip = прямой
// пир). Значение для прода надо ЗАМЕРИТЬ по числу адресов в X-Forwarded-For
// реального запроса, а не угадать: занижение делает лимитер попыток входа
// общим на всех, завышение позволяет клиенту подделать свой адрес.
const TRUST_PROXY_HOPS = Number(process.env.TRUST_PROXY_HOPS || 0);

const { handleNewEmails } = require("./middleware/emailHandling");

const {
  createTicketNotifications,
  createCommentNotifications,
  createScheduledWorkNotifications,
} = require("./middleware/notifications");

// Разбор очереди писем. Раньше жил в telegram-bot — см. services/mail/outbox.
const { sendPendingEmails } = require("./services/mail/outbox");

const { scheduleLogsCleanup } = require("./middleware/cleanupLogs");
const {
  runMikrotikHealthCheck,
} = require("./middleware/mikrotikHealthCheck");
const {
  runMikrotikScheduler,
} = require("./middleware/mikrotikScheduler");
const { runMikrotikOfflineAlerts } = require("./services/mikrotik/alerts");
const {
  runMikrotikFirmwareRefresh,
  runMikrotikFirmwareRefreshIfStale,
} = require("./services/mikrotik/firmware");
const { runUpgradeTick } = require("./services/mikrotik/upgradeWorker");
const {
  runKnowledgeApprovalExpiry,
} = require("./services/knowledgeApprovalExpiry");
const { runSecretsScan } = require("./services/secretsScanRun");
const { runWorkStatusReset } = require("./services/workStatusReset");
const { runWorkStatusAuto } = require("./services/workStatusAuto");
const { liftExpiredBans } = require("./services/authBan");
const { runReportAutoApproval } = require("./services/reportAutoApproval");
const {
  runServiceExpiryScan,
} = require("./services/serviceExpiryScanRun");
const {
  syncCalendar: syncProductionCalendar,
} = require("./services/productionCalendar");
const Preferences = require("./models/preferences");
const { DEFAULT_TIMEZONE } = require("./utils/datetime");

const PORT = process.env.PORT || 8080;
const app = express();

app.set("trust proxy", TRUST_PROXY_HOPS);

/**
 * Заголовки безопасности.
 *
 * CSP ЗДЕСЬ НЕ СТАВИТСЯ ГЛОБАЛЬНО: этот процесс отдаёт только `/api` и
 * `/uploads`, а документ приложения раздаёт nginx — его политика живёт в
 * `nginx/nginx.conf`, и вторая копия на другом слое разошлась бы с первой.
 *
 * Что действительно нужно здесь — `nosniff`: без него браузер угадывает тип по
 * содержимому, и ответ API с чужим текстом внутри может быть исполнен как
 * скрипт. Отдельная жёсткая политика для загруженных файлов — ниже, у самого
 * маршрута.
 */
app.use(
  helmet({
    contentSecurityPolicy: false,
    // Мы не раздаём страниц, но фреймить наши ответы всё равно незачем.
    frameguard: { action: "deny" },
    // Адрес заявки не должен уезжать в Referer на сторонние домены.
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    // HSTS выставляет nginx на терминации TLS: здесь трафик уже расшифрован,
    // и заголовок отсюда либо продублируется, либо соврёт про схему.
    hsts: false,
    crossOriginResourcePolicy: { policy: "same-site" },
  }),
);

// Performance and monitoring middleware
app.use(requestIdMiddleware);
app.use(performanceMonitor);
app.use(compressionMiddleware);

// better-auth ЧИТАЕТ СЫРОЕ ТЕЛО — регистрируется строго ДО express.json(),
// иначе тот его съест и запросы к /api/auth/* будут висеть до таймаута без
// внятной ошибки. Проверка после правок: POST на /api/auth/reset-password с
// телом `{}` должен отвечать 400 быстрее секунды.
// Express 5 требует именованный splat: "*" больше не валидный шаблон.
//
// Снаружи открыты только ручки из списка (middleware/authPathAllowList.js):
// остальное — `/admin/*`, `/organization/*`, вход паролем мимо `/api/login` —
// отвечает 404. Серверные вызовы `auth.api.*` через роутер не идут.
app.all("/api/auth/*splat", authPathAllowList, authRequestHandler);

// Разбор тела — с лимитом по классу маршрута: анонимные ручки 100 КБ,
// редакторы с картинками 50 МБ, остальное 10 МБ (middleware/bodyParsers.js).
// Строго ПОСЛЕ better-auth выше: тот читает сырое тело сам.
require("./middleware/bodyParsers").mountBodyParsers(app);

mongoose.set("strictQuery", false);

// File serving for uploads. Legacy files (old tickets) live on the local/shared
// volume; new uploads live in S3. Serve local-first so old URLs keep working
// unchanged, otherwise 302-redirect to a short-lived presigned S3 URL. The
// /uploads/<name> URL is therefore identical for old and new files.
app.get("/uploads/:name", async (req, res) => {
  /**
   * ЗАГРУЖЕННЫЙ ФАЙЛ — ЧУЖОЙ КОД НА НАШЕМ ДОМЕНЕ.
   *
   * Вложения к заявкам приходят от кого угодно, включая почту, и отдаются с
   * того же origin, что и приложение. HTML или SVG со скриптом внутри
   * превращается в хранимую XSS: скрипт выполнится в нашем домене и дотянется
   * до сессионной cookie.
   *
   * `sandbox` в CSP отключает для этого ответа скрипты, формы и переходы —
   * картинка и PDF смотрятся, а разметка исполняться перестаёт. `nosniff`
   * запрещает угадывать тип по содержимому: без него `.txt` со скриптом внутри
   * браузер может решить исполнить.
   */
  res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
  res.setHeader("X-Content-Type-Options", "nosniff");

  const name = path.basename(req.params.name);

  // Defense-in-depth against path traversal: must be a plain file name.
  if (!name || name !== req.params.name) {
    return res.status(400).json({ error: "Invalid file name" });
  }

  if (storage.objectExistsLocally(name)) {
    return res.sendFile(
      path.resolve("uploads", name),
      { headers: { "Cache-Control": "public, max-age=31536000, immutable" } },
      (error) => {
        if (error && !res.headersSent) {
          logger.warn(`File not found: ${redactUrl(req.originalUrl)}`);
          res.status(404).json({
            error: "File not found",
            message: "The requested file does not exist",
          });
        }
      },
    );
  }

  try {
    return res.redirect(302, await storage.presignGetUrl(name));
  } catch (error) {
    logger.warn(
      `Failed to resolve upload ${redactUrl(req.originalUrl)}: ${error.message}`,
    );
    return res.status(404).json({
      error: "File not found",
      message: "The requested file does not exist",
    });
  }
});

app.use(require("./middleware/cors"));

// Ключи-операторы Mongo (`$…`, с точкой) в теле внешнего API и ручек без
// сеанса — сразу 400 (middleware/rejectOperatorKeys.js). Стоит после разбора
// тела; глобально — после ревизии остальных маршрутов (W5).
const {
  OPERATOR_GUARD_PATHS,
  rejectOperatorKeys,
} = require("./middleware/rejectOperatorKeys");
app.use(OPERATOR_GUARD_PATHS, rejectOperatorKeys);

// API routes with caching for read-only endpoints
app.use("/api", internal);
app.use("/api", external);
app.use("/health", public);

app.use((req, res) => {
  res.status(404).json({
    error: true,
    status: 404,
    code: "ERR_404",
    message: "Endpoint not found",
  });
});

app.use(errorResponse);

let server;

mongoose
  .connect(
    `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
  )
  .then(async () => {
    // Инстанс better-auth собирается на УЖЕ открытом соединении mongoose —
    // отсюда и порядок: сначала connect, потом initAuth, и только затем listen,
    // чтобы к первому запросу хендлер /api/auth/* был готов.
    await initAuth();
    // Пустая база → администратор, компания и настройки. Идемпотентно: на
    // непустой не делает ничего. Заменяет удалённую ручку /api/first-launch.
    await require("./services/bootstrapSeed").seedFirstLaunch();
    server = app.listen(PORT, () => {
      logger.log("info", `Server started on port ${PORT}`);
      initializeMonitoring();
    });
  })
  .catch((error) => {
    // Без базы и better-auth серверу делать нечего: пишем в журнал и выходим с
    // 1 — Docker перезапустит. Раньше здесь был throw, и процесс ронял
    // необработанный отказ; теперь unhandledRejection только записывается
    // (конец файла), и процесс остался бы жить без базы. winston пишет в
    // stdout не синхронно — даём строке уйти в журнал до выхода.
    // Выход взводится первым, а отказ необязательно Error: reject(undefined)
    // или throw null не должны оставить процесс жить без базы и без HTTP.
    process.exitCode = 1;
    setTimeout(() => process.exit(1), 500).unref();
    logger.log("error", "Failed to start server", {
      error: error?.message ?? String(error),
      stack: error?.stack,
    });
  });

// Все крон-задания — через один реестр (services/jobs/guardedCron.js): замок
// «не больше одного прогона» держится, пока прогон действительно не
// закончится (сторож только пишет ошибку), без базы тик пропускается, а при
// остановке реестр гасит расписания и ждёт идущие прогоны (см. shutdown ниже).
const { createCronRegistry } = require("./services/jobs/guardedCron");

const { isAuthReady } = require("./auth/bootstrap");

const jobs = createCronRegistry({
  schedule: cron.schedule,
  log: (...args) => logger.log(...args),
  // Готовность — база И better-auth: задания трогают права (почта считает
  // доступ сотрудника к заявке через canAccessTicket), а initAuth кончается
  // уже после подключения к базе. Тик в этом окне пропускается, как без базы
  isDbReady: () => mongoose.connection.readyState === 1 && isAuthReady(),
});

// check email for new tickets
// Запас: нормальный прогон занимает секунды. Сторож только кричит в журнал —
// замок держится, пока handleNewEmails не закончится: второй разбор ящика
// поверх зависшего завёл бы заявки из одних и тех же писем дважды. Реальные
// зависания IMAP закрывает socketTimeout (30с) задолго до этого.
const EMAIL_RUN_TIMEOUT_MS = 180000;
jobs.register(
  "email intake",
  "*/20 * * * * *",
  () => handleNewEmails(),
  EMAIL_RUN_TIMEOUT_MS,
);

// create notifications
// Гейта по почте/Telegram больше нет: канал «в приложении» есть всегда, а свои
// рубильники почта и Telegram проверяют внутри заданий. Каждое задание — в
// своём try: сбой одного не отменяет остальные.
const notificationJobs = [
  ["ticket notifications", createTicketNotifications],
  ["comment notifications", createCommentNotifications],
  ["scheduled work notifications", createScheduledWorkNotifications],
];
jobs.register(
  "notification creation",
  "*/10 * * * * *",
  async () => {
    for (const [jobName, createNotifications] of notificationJobs) {
      try {
        await createNotifications();
      } catch (error) {
        logger.log("error", `Failed to create ${jobName}`, {
          error: error.message,
          stack: error.stack,
        });
      }
    }
  },
  0,
  { quietSkip: true },
);

// The three Mikrotik crons used to share `*/5 * * * *` and therefore fired in the
// same second. That was a correctness bug, not just contention: the alert cron read
// `status` while the health-check was still polling, so it ticketed devices by a
// five-minute-old snapshot. They are now staggered — health-check at :00, the config
// exporter at :02 (its SSH /export no longer loads a weak device's CPU during the
// health-check's TLS handshake), alerts at :04, giving the health-check four minutes
// of head start. Beware: node-cron reads `2-59/5` as "every 5th minute from zero
// within 2..59", i.e. 5,10,…,55 — an offset must be an explicit minute list.
const EVERY_5_MIN = "*/5 * * * *";
const EVERY_5_MIN_AT_2 = "2,7,12,17,22,27,32,37,42,47,52,57 * * * *";
const EVERY_5_MIN_AT_4 = "4,9,14,19,24,29,34,39,44,49,54,59 * * * *";

// Автостатусы присутствия по графику — каждые 5 минут. Таймзона крона здесь
// НЕ нужна: у каждого сотрудника свой пояс, и «сейчас в смене?» считается
// внутри прогона по графику, заданному в поясе организации.
jobs.register(
  "work status auto-switch",
  EVERY_5_MIN,
  () => runWorkStatusAuto(),
  120000,
);

/**
 * Отправка почтовых уведомлений. Переехало из telegram-bot вместе с самой
 * почтой: очередь всегда лежала здесь, а разбирал её бот — только потому, что
 * там крутился крон. Ценой была удалённая машина с почтовым паролем и ключом
 * его расшифровки.
 *
 * Каждые 20 секунд, как и было. Реестр не даёт прогонам наслаиваться, а каждое
 * письмо ещё и берётся в аренду (services/mail/outbox.js): два прогона не возьмут
 * одно письмо. Гарантия — at-least-once, не «ровно раз»: письмо, оборванное между
 * принятием SMTP-сервером и отметкой об исходе (остановка, сбой базы), уйдёт
 * повторно, когда истечёт аренда.
 */
jobs.register("mail outbox", "*/20 * * * * *", sendPendingEmails, 110000);

// Refresh connectivity status of monitored Mikrotik devices every 5 minutes.
jobs.register(
  "Mikrotik health-check",
  EVERY_5_MIN,
  runMikrotikHealthCheck,
  240000,
);

// Run due Mikrotik config-export schedules (an export may hold SSH for up to 60s).
jobs.register(
  "Mikrotik scheduler",
  EVERY_5_MIN_AT_2,
  runMikrotikScheduler,
  270000,
);

// Raise a ticket for Mikrotik devices offline past the configured threshold
// (Preferences.mikrotik.offlineTicket.thresholdMinutes, 15 min by default). Each
// candidate is re-polled first, so a device that has since recovered is never
// ticketed. 240s: one re-poll batch can take ~72s worst case (deadline + retry),
// and tunneled («через устройство») re-polls add an SSH handshake per attempt —
// the old 120s bound was already brushable at two batches.
jobs.register(
  "Mikrotik offline-alert",
  EVERY_5_MIN_AT_4,
  runMikrotikOfflineAlerts,
  240000,
);

// Firmware upgrade batches: one step of the current device per tick
// (docs/mikrotik-management.md, «Firmware upgrades»). A step may hold a package
// download for up to 10 minutes; the in-flight lock keeps ticks from stacking,
// and those skips are expected — hence quietSkip.
jobs.register(
  "Mikrotik upgrade worker",
  "*/20 * * * * *",
  () => runUpgradeTick(),
  15 * 60 * 1000,
  { quietSkip: true },
);

// Кэш релизов RouterOS + CVE из NVD + авто-заявка «уязвимая прошивка». Суточного
// прогона достаточно (релизы выходят реже раза в неделю, лимит NVD — 5 req/30s);
// UTC, как и остальные задания без пояса; минута 23 — вне решётки */5 микротик-кронов.
jobs.register(
  "Mikrotik firmware refresh",
  "23 3 * * *",
  runMikrotikFirmwareRefresh,
  120000,
);

// Knowledge base: scan notes for exposed secrets every hour
jobs.register(
  "Knowledge base secrets scan",
  "0 * * * *",
  () => runSecretsScan(),
  0,
  { quietSkip: true },
);

// Отключения с вышедшим сроком — снимаем раз в минуту. Гейты доступа считают
// срок сами (`isBanned`), а этот прогон приводит в порядок ДОКУМЕНТ: списки,
// рассылка и табло фильтруют по `banned` и про срок не знают. Плагин `admin`
// снял бы флаг при входе, но до его хука наши гейты не доходят, а клиенты
// входят редко — письма при этом идут им постоянно (см. services/authBan).
jobs.register(
  "expired bans lift",
  "* * * * *",
  async () => {
    const lifted = await liftExpiredBans();
    if (lifted) {
      logger.log("info", `Expired bans lifted: ${lifted}`);
    }
  },
  10000,
);

// «Диалоги»: ответы, застрявшие между комментарием, сообщением и заданием
// шлюзу (services/messaging/outbound.js#repairOutbound)
jobs.register(
  "messagingRepair",
  "* * * * *",
  () => require("@/services/messaging/outbound").repairOutbound(),
  50 * 1000,
);

// Ночные обслуживающие задания — по настенным часам БИЗНЕС-таймзоны: без
// опции node-cron исполнял бы «2:00»/«3:00» по UTC контейнера, т.е. днём для
// восточных поясов. Таймзона читается из настроек один раз при старте
// (Preferences.findOne буферизуется mongoose до подключения к БД); смена зоны
// в настройках подхватится после рестарта — как у задач checkRoutineTasks.
// fixedTimezone — пояс «как есть», настройки тогда не читаются: так регистрацию
// повторяют после отказа node-cron (см. вызов ниже).
const registerMaintenanceCrons = async (fixedTimezone) => {
  let timezone = fixedTimezone ?? DEFAULT_TIMEZONE;
  if (fixedTimezone === undefined) {
    try {
      const prefs = await Preferences.findOne({});
      if (prefs?.timezone) {
        timezone = prefs.timezone;
      }
    } catch (error) {
      logger.log("error", "Failed to read timezone for maintenance crons", {
        error: error.message,
      });
    }
  }

  const nightly = { timezone, quietSkip: true };

  // Cleanup old company logs every day at 2:00 AM
  jobs.register(
    "company logs cleanup",
    "0 2 * * *",
    () => scheduleLogsCleanup(),
    0,
    nightly,
  );

  // Статусы присутствия: ночной сброс, кроме долгих (отпуск/болею) — daily 2:30
  jobs.register(
    "work status nightly reset",
    "30 2 * * *",
    () => runWorkStatusReset(),
    0,
    nightly,
  );

  // Knowledge base: revert approvals whose approval period has expired (daily 3:00)
  jobs.register(
    "knowledge approval expiry",
    "0 3 * * *",
    () => runKnowledgeApprovalExpiry(),
    0,
    nightly,
  );

  // Согласование отчётов: напоминание за сутки до срока и автоподпись после
  // него (daily 4:15 — после ночных пересчётов, до начала рабочего дня)
  jobs.register(
    "report auto-approval",
    "15 4 * * *",
    () => runReportAutoApproval(),
    0,
    nightly,
  );

  // Knowledge base: parse service-renewal tables daily (3:30)
  jobs.register(
    "knowledge base service-expiry scan",
    "30 3 * * *",
    () => runServiceExpiryScan(),
    0,
    nightly,
  );

  // Производственный календарь: догрузить текущий и следующий год (3:45).
  // Следующий год публикуется осенью — до этого его 404 штатный и в lastError
  // не пишется (см. syncCalendar).
  jobs.register(
    "production calendar sync",
    "45 3 * * *",
    () => syncProductionCalendar(),
    0,
    nightly,
  );
};

// Пояс из настроек node-cron мог не принять: в API это свободный текст
// (validations/preferences.js проверяет только длину), а node-cron сверяет зону
// прямо в schedule() и бросает RangeError. Без повтора шесть ночных заданий молча
// пропали бы до рестарта — unhandledRejection только пишет в журнал. Зона
// проверяется на первой же регистрации, поэтому после отказа ни одно ночное
// задание ещё не стоит и повтор их не задвоит. Повтор — в поясе по умолчанию.
registerMaintenanceCrons()
  .catch((error) => {
    logger.log(
      "error",
      "Failed to register maintenance crons, retrying with the default timezone",
      {
        timezone: DEFAULT_TIMEZONE,
        error: error?.message ?? String(error),
      },
    );
    return registerMaintenanceCrons(DEFAULT_TIMEZONE);
  })
  .catch((error) => {
    logger.log(
      "error",
      "Failed to register maintenance crons with the default timezone",
      { error: error?.message ?? String(error) },
    );
  });

// Initialize monitoring first
setTimeout(() => {
  checkRoutineTasks();
}, 1000);

// Первый деплой / долгий простой: не ждать суточного крона, если кэш релизов/CVE
// пуст или старше суток (свежий кэш — no-op).
setTimeout(() => {
  runMikrotikFirmwareRefreshIfStale();
}, 30000);

// Мягкая остановка. `docker stop` шлёт SIGTERM и ждёт stop_grace_period (60 с,
// compose.yml), потом SIGKILL. Порядок: расписания гасятся — новых прогонов нет;
// идущие дорабатывают до 50 с (письмо, взятое в аренду, должно уйти, а заявка
// из письма — дописаться); затем закрываем HTTP-сервер и Mongo — и выходим
// ЯВНО: таймеры иначе держат процесс живым до SIGKILL. Будильник на выход
// ставится первым и срабатывает до SIGKILL, чтобы зависший прогон или запрос
// не превратил остановку в убийство.
const SHUTDOWN_DRAIN_MS = 50 * 1000;
const SHUTDOWN_HARD_EXIT_MS = 58 * 1000;

let shuttingDown = false;
let repeatedSignalLogged = false;
const shutdown = async (signal) => {
  if (shuttingDown) {
    // Повторный сигнал (нетерпеливое второе `docker stop`) остановку не рвёт:
    // пишем один раз и игнорируем. Жёсткий предел остановки — будильник ниже и
    // SIGKILL от Docker после stop_grace_period.
    if (!repeatedSignalLogged) {
      repeatedSignalLogged = true;
      logger.log("warn", `${signal} received again, shutdown is already in progress`);
    }
    return;
  }
  shuttingDown = true;
  setTimeout(() => process.exit(1), SHUTDOWN_HARD_EXIT_MS).unref();
  logger.log("info", `${signal} received, shutting down`);

  jobs.stopAll();
  // Регламенты (middleware/taskManager.js) живут в node-cron напрямую, мимо
  // реестра: гасим и их. Их прогон — одна заявка, его не ждём.
  for (const task of cron.getTasks().values()) {
    task.stop();
  }

  const pending = await jobs.drain(SHUTDOWN_DRAIN_MS);
  if (pending.length) {
    logger.log("warn", "Shutdown: jobs still running after the drain window", {
      pending,
    });
  }

  try {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await mongoose.disconnect();
  } catch (error) {
    logger.log("warn", "Shutdown: failed to close cleanly", {
      error: error.message,
    });
  }
  process.exit(0);
};

// process.on, а не once: после once повторный сигнал возвращает Node действие по
// умолчанию — процесс умирает на месте, без drain и без строки в журнале
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Промис без обработчика — ошибка в коде, но не повод ронять процесс: на нём
// кроны и запросы остальных пользователей. Пишем в журнал и живём дальше.
process.on("unhandledRejection", (reason) => {
  logger.log("error", "Unhandled promise rejection", {
    error: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

// Синхронное исключение мимо всех try — состояние процесса неизвестно. Пишем в
// журнал и выходим с 1: Docker (restart: unless-stopped) поднимет чистый процесс.
process.on("uncaughtException", (error) => {
  logger.log("error", "Uncaught exception, exiting", {
    error: error?.message,
    stack: error?.stack,
  });
  // winston пишет в stdout не синхронно — даём строке уйти в журнал до выхода
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 500).unref();
});
