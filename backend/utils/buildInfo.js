/**
 * Версия и коммит сборки. Образ пишет их в build-info.json последним слоем
 * (backend/Dockerfile); в dev файла нет, и сборка называется "dev".
 *
 * Это файл, а не переменная окружения, намеренно: backend получает весь .env
 * через env_file, и случайный ключ оттуда перекрыл бы ENV образа.
 */
const fs = require("node:fs");
const path = require("node:path");

const FILE = path.join(__dirname, "..", "build-info.json");

const clean = (value) => (typeof value === "string" && value.trim() ? value.trim() : "dev");

const readBuildInfo = (file = FILE) => {
  let raw = null;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    raw = null;
  }
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const version = clean(source.version);
  const commit = clean(source.commit);
  return { version, commit, id: version === "dev" ? "dev" : `${version}+${commit}` };
};

module.exports = { readBuildInfo, buildInfo: readBuildInfo() };
