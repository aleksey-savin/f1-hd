/**
 * Шапка статьи справки: плоские пары `ключ: значение` между строками `---`.
 * Свой разборщик вместо YAML-библиотеки: вложенности и типов в шапке нет, а
 * зависимость ради пяти строк не нужна.
 */
const strip = (value) => {
  const trimmed = value.trim();
  const quoted = /^(["'])(.*)\1$/.exec(trimmed);
  return quoted ? quoted[2] : trimmed;
};

const parseFrontMatter = (text) => {
  const lines = String(text || "")
    .replace(/^﻿/, "")
    .split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return null;

  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end === -1) return null;

  const meta = {};
  for (const line of lines.slice(1, end)) {
    if (line.trim().startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    meta[line.slice(0, colon).trim()] = strip(line.slice(colon + 1));
  }

  return { meta, body: lines.slice(end + 1).join("\n").trim() };
};

module.exports = { parseFrontMatter };
