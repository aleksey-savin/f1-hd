/**
 * Каталог видов события заявки — единственное место, где фраза лога получает
 * смысл.
 *
 * Зачем: в `TicketLog` исторически лежит только свободный текст (`event`) и
 * `severity`, причём у старых записей severity пуст. Читать такую ленту нельзя:
 * у одной живой заявки 1506 записей, из них 1476 — «при отправке
 * email-уведомления». Хронике на карточке нужны события заявки, а доставка и
 * служебные записи ИИ должны сворачиваться.
 *
 * Как: вид (`kind`) проставляется автоматически хуком модели при записи (см.
 * models/ticketLog.js), а старые 1,5 млн записей классифицируются тем же
 * `classify` при чтении — миграция коллекции ради поля, которое выводится из
 * текста, не окупается.
 *
 * ВАЖНО: фраза события — часть контракта. Меняете формулировку в контроллере —
 * правьте образец здесь, иначе запись потеряет вид и уедет в «прочее».
 */

// technical: true — служебное, в ленту отдельной записью не попадает, а
// сворачивается в счётчик под предыдущим событием заявки.
const KINDS = {
  created: { technical: false },
  processed: { technical: false },
  taken: { technical: false },
  takenOver: { technical: false },
  joined: { technical: false },
  helpRequested: { technical: false },
  deadline: { technical: false },
  updated: { technical: false },
  workAdded: { technical: false },
  workUpdated: { technical: false },
  checklist: { technical: false },
  // Вложения, приехавшие вместе с заявкой, событием не отмечаются — они уже
  // перечислены в описании. В ленту попадает только то, что принесли позже
  attachmentAdded: { technical: false },
  attachmentRemoved: { technical: false },
  rejected: { technical: false },
  closed: { technical: false },
  reopened: { technical: false },
  // Комментарий в ленте показывает сам комментарий — событие о нём было бы
  // вторым упоминанием того же
  comment: { technical: false, hidden: true },
  delivery: { technical: true },
  ai: { technical: true },
  other: { technical: false },
};

const RULES = [
  [/^создана новая заявка/i, "created"],
  [/^обработана заявка/i, "processed"],
  [/принята в работу/i, "taken"],
  [/взял\(а\) заявку на себя/i, "takenOver"],
  [/присоединил/i, "joined"],
  [/запросил\(а\) помощь/i, "helpRequested"],
  [/дедлайн/i, "deadline"],
  [/^заявка обновлена/i, "updated"],
  [/добавлены работы/i, "workAdded"],
  [/(обновлены|удалены) работы/i, "workUpdated"],
  [/чек-лист/i, "checklist"],
  [/^прикреплен/i, "attachmentAdded"],
  [/^удалён файл|^удалены файлы/i, "attachmentRemoved"],
  [/отказ от заявки/i, "rejected"],
  [/^заявка закрыта/i, "closed"],
  [/возвращена в работу|вернул/i, "reopened"],
  [/добавлен комментарий/i, "comment"],
  [/уведомлени|уведомление|при отправке/i, "delivery"],
  [/ии |^ии\b|ai-|распознавани|подбор категории|категори[юи] заявки/i, "ai"],
];

/** Вид записи по её тексту. Неизвестное — «прочее», но не служебное: лучше
 *  показать лишнюю строку, чем спрятать событие, о котором мы не знали. */
const classify = (event = "") => {
  for (const [pattern, kind] of RULES) {
    if (pattern.test(event)) return kind;
  }
  return "other";
};

const isTechnical = (kind) => Boolean(KINDS[kind]?.technical);
const isHidden = (kind) => Boolean(KINDS[kind]?.hidden);

/**
 * Лента карточки: события заявки по возрастанию времени, служебные записи —
 * счётчиками под предыдущим событием.
 *
 * Служебное, пришедшее до первого события (такого почти не бывает), крепится к
 * первому же событию: висящая в воздухе строка «4 уведомления» без повода не
 * объясняет ничего.
 */
const buildFeed = (logs = []) => {
  const sorted = [...logs].sort(
    (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
  );

  const events = [];
  let pending = { count: 0, failed: 0, from: null, to: null };

  const flushInto = (entry) => {
    if (!entry || pending.count === 0) return;
    entry.technical = { ...pending };
    pending = { count: 0, failed: 0, from: null, to: null };
  };

  for (const log of sorted) {
    const kind = log.kind || classify(log.event);
    if (isHidden(kind)) continue;

    if (isTechnical(kind)) {
      pending.count += 1;
      if (log.severity === "danger" || /ошибка|не удалось|при отправке/i.test(log.event)) {
        pending.failed += 1;
      }
      pending.from = pending.from || log.createdAt;
      pending.to = log.createdAt;
      continue;
    }

    // Служебное, накопленное ПЕРЕД этим событием, принадлежит предыдущему —
    // кроме случая, когда предыдущего нет
    flushInto(events[events.length - 1] || null);
    if (pending.count > 0) {
      // Ничего не было раньше — отдадим первому событию
      events.push({
        _id: log._id,
        kind,
        event: log.event,
        user: log.user,
        severity: log.severity,
        createdAt: log.createdAt,
        ...(log.files?.length ? { files: log.files } : {}),
        technical: { ...pending },
      });
      pending = { count: 0, failed: 0, from: null, to: null };
      continue;
    }

    events.push({
      _id: log._id,
      kind,
      event: log.event,
      user: log.user,
      severity: log.severity,
      createdAt: log.createdAt,
      ...(log.files?.length ? { files: log.files } : {}),
    });
  }

  // Хвост служебного — под последним событием
  flushInto(events[events.length - 1] || null);

  return events;
};

/**
 * Что из ленты видит ЗАЯВИТЕЛЬ: ход заявки и работы по ней.
 *
 * Остальное — внутренняя кухня, и отдавать её клиенту незачем: кто к кому
 * присоединился, кто запросил помощь и отказался, как двигали срок, что стало
 * с чек-листом. Отбор стоит ЗДЕСЬ, а не на клиенте: невидимое в интерфейсе, но
 * уехавшее в ответ — всё равно выданное.
 *
 * «Прочее» в список не входит никогда: у него нет каталожной подписи, и в ленту
 * поехал бы текст лога, написанный для лога.
 */
const CLIENT_KINDS = new Set([
  "created",
  "processed",
  "taken",
  "workAdded",
  "workUpdated",
  "closed",
  "reopened",
]);

/**
 * Лента для заявителя. Счётчик служебных записей снимается вместе с видами:
 * это журнал доставки уведомлений, а не история заявки, и раскрыть его
 * заявителю всё равно нечем.
 */
const feedForClient = (events = []) =>
  events
    .filter((event) => CLIENT_KINDS.has(event.kind))
    .map(({ technical, ...event }) => event);

module.exports = {
  KINDS,
  CLIENT_KINDS,
  classify,
  isTechnical,
  isHidden,
  buildFeed,
  feedForClient,
};
