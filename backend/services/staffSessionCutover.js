const CUTOVER_ID = "2026-11-07-w5a";
const COUNT_KEYS = ["staffSessions", "impersonationSessions", "preservedClientSessions", "impersonationCodes"];

// Нормализуем только связи. Удаляемые записи сохраняют исходный BSON _id:
// строковый _id и ObjectId с тем же hex — разные записи Mongo.
const identity = (id) => {
  if (typeof id === "string" && id.length) {
    return /^[a-f\d]{24}$/i.test(id) ? id.toLowerCase() : id;
  }
  if (id?._bsontype === "ObjectId" && typeof id.toHexString === "function") {
    return id.toHexString();
  }
  return null;
};

const nativeId = (id) => {
  const key = identity(id);
  if (key === null) throw new Error("Invalid cutover record ID");
  return typeof id === "string" ? `string:${id}` : `object:${key}`;
};

const planStaffSessionCutover = ({ users, sessions, codes }) => {
  const audiences = new Map();
  for (const user of users) {
    const id = identity(user._id);
    if (id === null) throw new Error("Invalid cutover user ID");
    const staff = user.isEndUser === false;
    if (audiences.has(id) && audiences.get(id) !== staff) {
      throw new Error("Conflicting cutover user audience");
    }
    audiences.set(id, staff);
  }
  const isStaff = (id) => audiences.get(identity(id)) === true;
  const sessionIds = [], codeIds = [];
  const counts = Object.fromEntries(COUNT_KEYS.map((key) => [key, 0]));
  for (const session of sessions) {
    if (isStaff(session.userId)) {
      sessionIds.push(session._id);
      counts.staffSessions++;
    } else if (isStaff(session.impersonatedBy)) {
      sessionIds.push(session._id);
      // Не пересекается с сеансами сотрудников: эти два счётчика образуют объединение.
      counts.impersonationSessions++;
    } else if (audiences.get(identity(session.userId)) === false) {
      counts.preservedClientSessions++;
    }
  }
  for (const code of codes) {
    if (isStaff(code.adminId) || isStaff(code.impersonatedBy)) codeIds.push(code._id);
  }
  counts.impersonationCodes = codeIds.length;
  // При ошибочных или повторных выбранных ID останавливаемся до записи плана.
  for (const ids of [sessionIds, codeIds]) {
    if (new Set(ids.map(nativeId)).size !== ids.length) {
      throw new Error("Duplicate cutover record ID");
    }
  }
  return { sessionIds, codeIds, counts };
};

const validateSnapshot = (snapshot) => {
  const invalid = () => { throw new Error("Invalid staff cutover snapshot"); };
  if (snapshot?._id !== CUTOVER_ID || !(snapshot.capturedAt instanceof Date) ||
      !Number.isFinite(snapshot.capturedAt.getTime())) invalid();
  for (const ids of [snapshot.sessionIds, snapshot.codeIds]) {
    if (!Array.isArray(ids)) invalid();
    try {
      if (new Set(ids.map(nativeId)).size !== ids.length) invalid();
    } catch { invalid(); }
  }
  const counts = snapshot.counts;
  if (!COUNT_KEYS.every((key) => Number.isSafeInteger(counts?.[key]) && counts[key] >= 0) ||
      counts.staffSessions + counts.impersonationSessions !== snapshot.sessionIds.length ||
      counts.impersonationCodes !== snapshot.codeIds.length) invalid();
};

/** Запускать при остановленных писателях приложения в обычном цикле развёртывания.
 * Повторные запуски не выбирают цели заново: новые входы сотрудников отсутствуют в сохранённых ID.
 * Записываются только снимок и две коллекции браузерной авторизации.
 */
const runStaffSessionCutover = async ({ db, apply = false, now = () => new Date() }) => {
  const cutovers = db.collection("authCutovers", { readConcern: { level: "majority" } });
  const filter = { _id: CUTOVER_ID };
  let snapshot = await cutovers.findOne(filter);
  if (!snapshot) {
    const [users, sessions, codes] = await Promise.all([
      db.collection("users").find({}, { projection: { _id: 1, isEndUser: 1 } }).toArray(),
      db.collection("authSessions").find({}, { projection: { _id: 1, userId: 1, impersonatedBy: 1 } }).toArray(),
      db.collection("impersonationCodes").find({}, { projection: { _id: 1, adminId: 1, impersonatedBy: 1 } }).toArray(),
    ]);
    const plan = planStaffSessionCutover({ users, sessions, codes });
    snapshot = { _id: CUTOVER_ID, capturedAt: new Date(typeof now === "function" ? now() : now), ...plan };
    validateSnapshot(snapshot);
    if (apply) {
      const { _id: _ignored, ...data } = snapshot;
      try {
        const result = await cutovers.updateOne(filter, { $setOnInsert: data }, {
          upsert: true, writeConcern: { w: "majority" },
        });
        if (!result.acknowledged) throw new Error("Unacknowledged staff cutover snapshot");
      } catch (error) {
        // Параллельная вставка может первой занять уникальный _id. При прочих ошибках останавливаемся.
        if (error.code !== 11000) throw error;
      }
      // Всегда используем сохранённые выигравшие ID, а не кандидатов этого процесса.
      snapshot = await cutovers.findOne(filter);
    }
  }
  validateSnapshot(snapshot);
  const counts = Object.fromEntries(COUNT_KEYS.map((key) => [key, snapshot.counts[key]]));
  if (!apply) return { apply: false, counts };

  const deleted = { sessions: 0, codes: 0 };
  if (snapshot.sessionIds.length) {
    const result = await db.collection("authSessions").deleteMany({ _id: { $in: snapshot.sessionIds } });
    deleted.sessions = result.deletedCount;
  }
  if (snapshot.codeIds.length) {
    const result = await db.collection("impersonationCodes").deleteMany({ _id: { $in: snapshot.codeIds } });
    deleted.codes = result.deletedCount;
  }
  return { apply: true, counts, deleted };
};

module.exports = { planStaffSessionCutover, runStaffSessionCutover };
