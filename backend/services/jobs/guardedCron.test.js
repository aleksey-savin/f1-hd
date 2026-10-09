// node --test services/jobs/guardedCron.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { createCronRegistry } = require("./guardedCron");

// Расписание-заглушка: помнит задания, тики крутит тест
const fakeSchedule = () => {
  const tasks = [];
  const schedule = (expression, tick, options) => {
    const task = {
      expression,
      tick,
      options,
      stopped: false,
      stop() {
        this.stopped = true;
      },
    };
    tasks.push(task);
    return task;
  };
  return { schedule, tasks };
};

// Прогон, который закончится, когда скажет тест
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const setup = ({ dbReady = () => true } = {}) => {
  const { schedule, tasks } = fakeSchedule();
  const logs = [];
  const registry = createCronRegistry({
    schedule,
    log: (level, message, meta) => logs.push({ level, message, meta }),
    isDbReady: dbReady,
  });
  return { registry, tasks, logs };
};

// Дать отработать .catch/.finally цепочки прогона
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("сторож пишет ошибку, но замок держится, пока прогон не закончится", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { registry, tasks, logs } = setup();
  const runs = [];
  registry.register(
    "mail outbox",
    "*/20 * * * * *",
    () => {
      const run = deferred();
      runs.push(run);
      return run.promise;
    },
    110000,
  );
  const [task] = tasks;

  task.tick();
  t.mock.timers.tick(110000);
  assert.ok(
    logs.some((l) => l.level === "error" && /mail outbox watchdog timeout/.test(l.message)),
    "сторож не сработал",
  );

  // Прежний guardedCron здесь отпускал замок, и второй прогон шёл поверх первого
  task.tick();
  assert.equal(runs.length, 1, "второй прогон запущен поверх зависшего");
  assert.ok(
    logs.some((l) => l.level === "warn" && l.message === "Skipping mail outbox: previous run is still active"),
  );

  runs[0].resolve();
  await settle();
  task.tick();
  assert.equal(runs.length, 2, "после завершения прогона замок не снят");
});

test("упавший прогон пишется в журнал и снимает замок", async () => {
  const { registry, tasks, logs } = setup();
  let calls = 0;
  registry.register(
    "work status auto-switch",
    "*/5 * * * *",
    () => {
      calls += 1;
      if (calls === 1) throw new Error("синхронно");
      return Promise.reject(new Error("асинхронно"));
    },
    120000,
  );
  const [task] = tasks;

  task.tick();
  await settle();
  task.tick();
  await settle();

  assert.equal(calls, 2);
  assert.deepEqual(
    logs.filter((l) => l.level === "error").map((l) => l.meta.error),
    ["синхронно", "асинхронно"],
  );
  assert.equal(logs[0].message, "work status auto-switch run failed");
});

test("без базы тик пропускается молча", () => {
  let ready = false;
  const { registry, tasks, logs } = setup({ dbReady: () => ready });
  let calls = 0;
  registry.register("expired bans lift", "* * * * *", () => {
    calls += 1;
  }, 10000);

  tasks[0].tick();
  assert.equal(calls, 0);
  assert.deepEqual(logs, []);

  ready = true;
  tasks[0].tick();
  assert.equal(calls, 1);
});

test("quietSkip пишет пропуск на уровне debug", async () => {
  const { registry, tasks, logs } = setup();
  const run = deferred();
  registry.register(
    "Mikrotik upgrade worker",
    "*/20 * * * * *",
    () => run.promise,
    15 * 60 * 1000,
    { quietSkip: true },
  );

  tasks[0].tick();
  tasks[0].tick();
  assert.deepEqual(logs.map((l) => l.level), ["debug"]);

  // Прогон закрываем: иначе настоящий 15-минутный сторож держал бы тест
  run.resolve();
  await settle();
});

test("пояс расписания уходит в node-cron, без пояса — без опций", () => {
  const { registry, tasks } = setup();
  registry.register("logs cleanup", "0 2 * * *", () => {}, 0, {
    timezone: "Asia/Vladivostok",
  });
  registry.register("mail outbox", "*/20 * * * * *", () => {}, 110000);

  assert.deepEqual(tasks[0].options, { timezone: "Asia/Vladivostok" });
  assert.equal(tasks[1].options, undefined);
});

test("stopAll гасит расписания, запоздавший тик ничего не запускает", () => {
  const { registry, tasks } = setup();
  let calls = 0;
  registry.register("a", "* * * * *", () => {
    calls += 1;
  }, 1000);
  registry.register("b", "* * * * *", () => {
    calls += 1;
  }, 1000);

  registry.stopAll();
  tasks[0].tick();

  assert.deepEqual(tasks.map((task) => task.stopped), [true, true]);
  assert.equal(calls, 0);
});

test("drain ждёт идущие прогоны и возвращается сразу, как они кончились", async () => {
  const { registry, tasks } = setup();
  const run = deferred();
  registry.register("email intake", "*/20 * * * * *", () => run.promise, 180000);
  tasks[0].tick();

  const draining = registry.drain(50000);
  run.resolve();
  assert.deepEqual(await draining, []);
});

test("drain не ждёт дольше срока и называет незаконченные", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { registry, tasks } = setup();
  const quick = deferred();
  const stuck = deferred();
  registry.register("mail outbox", "*/20 * * * * *", () => quick.promise, 110000);
  registry.register("Mikrotik scheduler", "*/5 * * * *", () => stuck.promise, 270000);
  tasks[0].tick();
  tasks[1].tick();

  const draining = registry.drain(50000);
  quick.resolve();
  await settle();
  t.mock.timers.tick(50000);

  assert.deepEqual(await draining, ["Mikrotik scheduler"]);
});

test("drain без идущих прогонов возвращается сразу", async () => {
  const { registry } = setup();
  assert.deepEqual(await registry.drain(50000), []);
});
