const mongoose = require("mongoose");

const Schema = mongoose.Schema;

// Кэш внешних данных о прошивках RouterOS + состояние авто-заявки безопасности.
// Живёт в собственных коллекциях, а НЕ в Preferences: админка сохраняет документ
// настроек целиком, и runtime-состояние там было бы затёрто первым же «Сохранить».

// Ветки, которые отслеживаем. Ключ = major + канал; файлы MikroTik:
// NEWESTa7.stable / NEWESTa7.long-term / NEWEST6.stable / NEWEST6.long-term.
const ROUTEROS_BRANCH_KEYS = [
  "7.stable",
  "7.long-term",
  "6.stable",
  "6.long-term",
];

// Последний релиз одной ветки (_id = ключ ветки). fetchedAt — последний УСПЕШНЫЙ
// опрос; при сбое документ не трогается (stale-кэш лучше пустоты), пишутся только
// lastError/lastErrorAt.
const routerOsReleaseSchema = new Schema(
  {
    _id: { type: String, enum: ROUTEROS_BRANCH_KEYS },
    version: String, // "7.23.2"
    releasedAt: Date, // unix-время из файла NEWEST*
    changelog: String, // текст CHANGELOG; тянется один раз на новую версию
    fetchedAt: Date,
    lastError: String,
    lastErrorAt: Date,
  },
  { timestamps: true },
);

// Один диапазон применимости CVE из NVD cpeMatch. edition — sw_edition из CPE:
// "ltr" = long-term, "stable" = обычная ветка, "any" = канал не указан.
// Либо exactVersion (точная версия в criteria), либо набор границ.
const cveMatcherSchema = new Schema(
  {
    edition: { type: String, enum: ["stable", "ltr", "any"], default: "any" },
    exactVersion: String,
    versionStartIncluding: String,
    versionStartExcluding: String,
    versionEndIncluding: String,
    versionEndExcluding: String,
  },
  { _id: false },
);

// Кэш CVE по cpe:2.3:o:mikrotik:routeros (NVD API 2.0). Полностью замещается
// после каждого УСПЕШНОГО фетча (upsert + удаление исчезнувших); при сбое NVD
// остаётся прежний набор.
const routerOsCveSchema = new Schema(
  {
    cveId: { type: String, unique: true },
    // v3.1 → v3.0 → v2; null, если метрик нет вовсе (порог тогда не проходится).
    baseScore: Number,
    baseSeverity: String,
    description: String,
    matchers: [cveMatcherSchema],
    published: Date,
    lastModified: Date,
    fetchedAt: Date,
  },
  { timestamps: true },
);

// Пункт отслеживания авто-заявки: какому устройству соответствует какой пункт
// чек-листа. Сопоставление — по точному description (эндпоинт полной замены
// чек-листа пересоздаёт _id пунктов, поэтому держаться за них нельзя).
const stateItemSchema = new Schema(
  {
    recordId: { type: Schema.Types.ObjectId, ref: "Mikrotik" },
    description: String,
    safe: { type: Boolean, default: false },
  },
  { _id: false },
);

// Keyed-синглтоны (_id — строковый ключ):
//  - "cve-sync"        → статус последней синхронизации с NVD;
//  - "security-ticket" → CAS-клейм и привязка единственной авто-заявки
//    (паттерн «claim first, create second», как offlineAlertedAt/alertTicketId
//    на записи устройства, но глобально).
const mikrotikFirmwareStateSchema = new Schema(
  {
    _id: String,
    // "cve-sync"
    lastSuccessAt: Date,
    lastError: String,
    lastErrorAt: Date,
    cveCount: Number,
    // "security-ticket"
    claimedAt: Date,
    ticketId: { type: Schema.Types.ObjectId, ref: "Ticket" },
    items: [stateItemSchema],
    allSafeCommentedAt: Date,
  },
  { timestamps: true },
);

module.exports = {
  RouterOsRelease: mongoose.model("RouterOsRelease", routerOsReleaseSchema),
  RouterOsCve: mongoose.model("RouterOsCve", routerOsCveSchema),
  MikrotikFirmwareState: mongoose.model(
    "MikrotikFirmwareState",
    mikrotikFirmwareStateSchema,
  ),
  ROUTEROS_BRANCH_KEYS,
};
