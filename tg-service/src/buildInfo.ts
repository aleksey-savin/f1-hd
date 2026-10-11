// Версия и коммит сборки: образ пишет build-info.json рядом с package.json
// (tg-service/Dockerfile); в dev файла нет, и сборка называется "dev".
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface BuildInfo {
  version: string;
  commit: string;
  id: string;
}

const FILE = fileURLToPath(new URL("../build-info.json", import.meta.url));

const clean = (value: unknown): string =>
  typeof value === "string" && value.trim() ? value.trim() : "dev";

export const readBuildInfo = (file: string = FILE): BuildInfo => {
  let raw: unknown = null;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    raw = null;
  }
  const source = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const version = clean(source.version);
  const commit = clean(source.commit);
  return { version, commit, id: version === "dev" ? "dev" : `${version}+${commit}` };
};

export const buildInfo = readBuildInfo();
