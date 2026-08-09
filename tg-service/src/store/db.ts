import { DatabaseSync } from "node:sqlite";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";

import { config } from "../config.ts";
import { logger } from "../logger.ts";

/**
 * Единственное состояние сервиса.
 *
 * Здесь лежит только то, что принадлежит ИМЕННО отправщику: что уже доставлено,
 * что уже нарисовано на табло и на каком шаге застрял диалог. Ничего из этого
 * не является данными приложения, и хранить это в общей базе было бы неверно —
 * а хранить там же, где заявки и пользователи, как делал прежний бот, тем более.
 *
 * Драйвер — встроенный `node:sqlite`, а не `better-sqlite3`. Причина
 * приземлённая: нативный модуль на musl обычно собирается из исходников, то есть
 * образу нужен python3/make/g++, а сервис должен разворачиваться на любой машине
 * без тулчейна. API нам нужен крошечный.
 */

let db: DatabaseSync | null = null;

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS sent_outbox (
     notification_id TEXT PRIMARY KEY,
     tg_message_id   INTEGER,
     sent_at         TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS board_state (
     chat_id       TEXT PRIMARY KEY,
     rendered_hash TEXT NOT NULL,
     updated_at    TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS dialog (
     tg_user_id TEXT PRIMARY KEY,
     step       TEXT NOT NULL,
     payload    TEXT,
     expires_at TEXT NOT NULL
   )`,
];

export const openDatabase = (): DatabaseSync => {
  if (db) return db;

  mkdirSync(dirname(config.dbPath), { recursive: true });
  db = new DatabaseSync(config.dbPath);

  // WAL — чтобы чтение табло не спотыкалось о запись очереди.
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  for (const statement of MIGRATIONS) {
    db.exec(statement);
  }

  logger.info("Локальная база открыта", { path: config.dbPath });
  return db;
};

export const getDatabase = (): DatabaseSync => {
  if (!db) {
    throw new Error("База не открыта: openDatabase() не вызывали");
  }
  return db;
};

export const closeDatabase = (): void => {
  db?.close();
  db = null;
};
