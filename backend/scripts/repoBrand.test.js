/**
 * Страж нейтральности репозитория: в продукте не должно остаться названия
 * прежнего владельца, его префикса темы и его домена. Проверяются все файлы
 * под контролем версий и новые, ещё не добавленные (кроме игнорируемых).
 *
 * Искомые слова собраны из частей, чтобы сам страж не попадал в свой список.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const OLD_BRAND = new RegExp(
  [["F1", "Lab"].join(""), ["F1", "HD"].join("-"), ["f1", "lab\\.ru"].join("")].join("|"),
  "i"
);

/** Каталоги и файлы, которые страж не читает вовсе. */
const SKIPPED = [
  /^docs\/superpowers\//, // планы и спецификации: история решений, не продукт
  /^\.superpowers\//, // рабочие записи агентов
  /^docs\/ux-ui-changelog\.md$/, // журнал изменений хранит прежние формулировки
  /(^|\/)node_modules(\/|$)/, // зависимости и симлинки на них
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)package-lock\.json$/,
  /(^|\/)yarn\.lock$/,
];

/**
 * Файлы, где прежнее название оставлено намеренно. Каждая запись — путь от
 * корня репозитория и причина в одну строку.
 */
const ALLOWED = [];

const allowedPaths = new Set(ALLOWED.map(([file]) => file));

const gitFiles = (...args) =>
  execFileSync("git", ["ls-files", "-z", ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter(Boolean);

const repoFiles = () => [
  ...new Set([...gitFiles(), ...gitFiles("--others", "--exclude-standard")]),
];

/** Текстовый ли файл: в первых 8 КБ нет нулевого байта. */
const isText = (buffer) => !buffer.subarray(0, 8192).includes(0);

const findHits = () => {
  const hits = [];
  for (const file of repoFiles().sort()) {
    if (SKIPPED.some((pattern) => pattern.test(file))) continue;
    if (allowedPaths.has(file)) continue;

    const absolute = path.join(REPO_ROOT, file);
    let stat;
    try {
      stat = fs.lstatSync(absolute);
    } catch {
      continue; // удалён в рабочем дереве, но ещё числится в индексе
    }
    if (!stat.isFile()) continue; // симлинки и каталоги-подмодули

    const buffer = fs.readFileSync(absolute);
    if (!isText(buffer)) continue;

    buffer
      .toString("utf8")
      .split("\n")
      .forEach((line, index) => {
        if (OLD_BRAND.test(line)) hits.push(`${file}:${index + 1}`);
      });
  }
  return hits;
};

test("в репозитории нет названия, префикса и домена прежнего владельца", () => {
  const hits = findHits();
  assert.deepEqual(
    hits,
    [],
    `Прежний бренд найден в ${hits.length} строках:\n${hits.join("\n")}`
  );
});

test("у каждой записи списка исключений есть причина и существующий файл", () => {
  for (const [file, reason] of ALLOWED) {
    assert.ok(reason && reason.trim(), `нет причины для ${file}`);
    assert.ok(fs.existsSync(path.join(REPO_ROOT, file)), `файла из списка нет: ${file}`);
  }
});
