// Каждое действие словаря обязано что-то закрывать.
//
// Право, которое нигде не проверяется, — это галочка, которая ВРЁТ
// администратору: он её выдал, а она ничего не открыла и ничего не закрыла.
// Прежний словарь копил такие: `canConfirmReportActions` и `canSeeAnalytics` не
// имели ни одного вызова `can()` на фронте, а `canApproveWorkReports` вообще
// нельзя было выдать из формы роли.
//
// Проверка текстовая и потому грубая: ищет в исходниках `ресурс: [… "действие"]`.
// Ложно-положительных не бывает (совпадение = действие где-то упомянуто),
// ложно-отрицательные возможны, если гейт собран динамически. На сегодня
// динамических гейтов нет ни одного.
//
// Сканируются ОБА дерева, backend/ и frontend/src: часть прав (`ticketCategory.read`,
// `checklistTemplate.read`, `inventoryCatalog.read` и им подобные) проверяется
// только фронтовым роут-гвардом, закрывающим СТРАНИЦУ справочника, — а бэкендный
// список, которым тот же справочник кормит выпадашку внутри чужой формы
// (категория в форме заявки, поставщик в форме устройства), открыт любому
// сотруднику без проверки: это не раздел, которым управляют, а чтение чужого
// списка ради выбора одного значения (спека 2026-09-11, «Выпадающий список
// внутри чужой формы права не требует»). Без frontend/src такие права
// считались бы мёртвыми, хотя реально закрыты.
//
// Вторая проверка, о гейтах, — с теми же допущениями: гейт считается
// повешенным, если его имя встречается в файле `routes/**` ВНЕ комментария.
// Значит, она видит только гейты, поставленные по имени; собранный динамически
// («гейт из переменной») она бы не нашла — таких сегодня нет.
//
// Запуск (не требует базы):
//   node scripts/checkPermissionCoverage.js
require("module-alias/register");
const fs = require("fs");
const path = require("path");

const { ALL_ACTIONS, GROUPS } = require("@/auth/access");

const ROOT = path.join(__dirname, "..");
const FRONTEND_SRC = path.join(ROOT, "..", "frontend", "src");
const SKIP_DIRS = new Set(["node_modules", "logs", "uploads", ".git"]);
// Сам словарь и каталог ролей не в счёт: там действия ПЕРЕЧИСЛЕНЫ, а не
// проверены, и без этого исключения проверка подтверждала бы саму себя.
const SKIP_FILES = new Set([
  path.join(ROOT, "auth", "access.js"),
  path.join(ROOT, "scripts", "legacyPermissions.js"),
  path.join(ROOT, "scripts", "checkPermissionCoverage.js"),
]);

const sources = [];
const walk = (dir, extensions) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, extensions);
    } else if (
      extensions.some((ext) => entry.name.endsWith(ext)) &&
      // Тест — не проверка права, а проверка кода: `can({ ticket: ["perform"] })`
      // в тестовом двойнике подтверждал бы мёртвое право живым
      !entry.name.endsWith(".test.js") &&
      !entry.name.endsWith(".test.jsx") &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".test.tsx") &&
      !SKIP_FILES.has(full)
    ) {
      sources.push(full);
    }
  }
};
walk(ROOT, [".js"]);
walk(FRONTEND_SRC, [".js", ".jsx", ".ts", ".tsx"]);

const haystack = sources.map((file) => fs.readFileSync(file, "utf8")).join("\n");

const unchecked = ALL_ACTIONS.filter((id) => {
  const [resource, action] = id.split(".");
  return !new RegExp(
    `${resource}\\s*:\\s*(\\[|\\{)[^}\\]]*["']${action}["']`,
  ).test(haystack);
});

console.log(`Групп: ${GROUPS.length}, действий: ${ALL_ACTIONS.length}`);

if (unchecked.length) {
  console.error(`\nНЕ ПРОВЕРЯЕТСЯ НИГДЕ: ${unchecked.length}`);
  for (const id of unchecked) console.error(`  ${id}`);
  console.error(
    "\nЛибо закройте этим правом то, ради чего оно заведено, либо уберите его " +
      "из словаря. Галочка без последствий хуже отсутствующей.",
  );
  process.exit(1);
}

console.log("Каждое действие словаря где-то проверяется.");

// ─────────────────────────────────────────────────────────────────────────────
// Вторая проверка: гейт, который никуда не повешен.
//
// Мидлварь из `middleware/permissions.js` сама по себе ничего не закрывает —
// она закрывает только тот маршрут, на котором стоит. Гейт, которого нет ни в
// одном файле `routes/**`, выглядит в коде как защита, а на деле маршрут открыт
// (так `canReadCompanyLogs` и `canReadServicePlans` пролежали ненавешенными,
// пока журнал компании закрывал `company.manage`, а прайс — «любой сотрудник»).
//
// Проверяется КАЖДЫЙ экспорт `middleware/permissions.js`, а не только имена на
// can/is/require: под прежним фильтром мимо проходили `allowedToViewTicket` и
// `selfOrCanManageUsers`. Исключения перечислены поимённо — фабрики, которые
// вызывает сам маршрут через обёртку, и гейты, чьё решение принимает контроллер.
const INLINE_GATES = new Set([
  // Фабрики: на маршруте стоит их РЕЗУЛЬТАТ (`requireTicketAccess((req) => …)`)
  "requireTicketAccess",
  "requireTicketsAccess",
]);

const GATES_FILE = path.join(ROOT, "middleware", "permissions.js");
const gates = [
  ...fs
    .readFileSync(GATES_FILE, "utf8")
    .matchAll(/module\.exports\.(\w+)\s*=/g),
]
  .map((match) => match[1])
  .filter((name) => !INLINE_GATES.has(name));

// Маршруты уже собраны обходом backend/ выше — отбираем их из общего списка.
// Комментарии вырезаются: гейт, УПОМЯНУТЫЙ в комментарии («без canReadKnowledge
// — намеренно»), не повешен ни на что, а голое совпадение по тексту засчитало бы
// его как повешенный.
const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

const routesText = sources
  .filter((file) => file.startsWith(path.join(ROOT, "routes") + path.sep))
  .map((file) => stripComments(fs.readFileSync(file, "utf8")))
  .join("\n");

const unmounted = gates.filter(
  (name) => !new RegExp(`\\b${name}\\b`).test(routesText),
);

if (unmounted.length) {
  console.error(`\nГЕЙТЫ НИ НА ОДНОМ МАРШРУТЕ: ${unmounted.length}`);
  for (const name of unmounted) console.error(`  ${name}`);
  console.error(
    "\nЛибо повесьте гейт на маршрут, ради которого он заведён, либо удалите " +
      "его: мидлварь, которую никто не вызывает, врёт о том, что маршрут закрыт. " +
      "Гейту, решение по которому принимает контроллер, место в INLINE_GATES.",
  );
  process.exit(1);
}

console.log(`Все гейты повешены на маршруты: ${gates.length}.`);
