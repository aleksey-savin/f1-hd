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
// Запуск (не требует базы):
//   node scripts/checkPermissionCoverage.js
require("module-alias/register");
const fs = require("fs");
const path = require("path");

const { ALL_ACTIONS, GROUPS } = require("@/auth/access");

const ROOT = path.join(__dirname, "..");
const SKIP_DIRS = new Set(["node_modules", "logs", "uploads", ".git"]);
// Сам словарь и каталог ролей не в счёт: там действия ПЕРЕЧИСЛЕНЫ, а не
// проверены, и без этого исключения проверка подтверждала бы саму себя.
const SKIP_FILES = new Set([
  path.join(ROOT, "auth", "access.js"),
  path.join(ROOT, "scripts", "legacyPermissions.js"),
  path.join(ROOT, "scripts", "checkPermissionCoverage.js"),
]);

const sources = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full);
    } else if (entry.name.endsWith(".js") && !SKIP_FILES.has(full)) {
      sources.push(full);
    }
  }
};
walk(ROOT);

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
