// Приём предложения ИИ-агента по инвентарю: заявитель, права, пределы, проверка пакета, запись.
// Ничего не применяет и не уведомляет (уведомление шлёт вызывающий). Модели трогает только mongoStore.
const { checkText } = require("../mikrotik/changeProposals");
const { createKeyLock } = require("../mcp/keyLock");
const { STATUS, TTL_MS, isOpen } = require("./changeSteps");

const MAX_TITLE = 200;
const MAX_REASON = 1000;
const MAX_OPERATIONS = 40;
const MAX_OPEN = 5;
const MAX_PER_DAY = 40;
const DAY_MS = 24 * 3600 * 1000;

// Названия прав (auth/access.js) и видов операций для отказов
const RIGHT_LABELS = {
  device: "Изменять технику и расположения",
  inventoryCatalog: "Изменять справочники техники",
  supplier: "Изменять поставщиков",
};
const KIND_LABELS = {
  catalog: "справочник",
  createVendor: "новый производитель",
  createSupplier: "новый поставщик",
  createModel: "новая модель",
  createConfiguration: "новая конфигурация",
  createBuild: "новая сборка",
  createDevice: "новое устройство",
  updateDevice: "изменение устройства",
  assignDevice: "выдача устройства",
  moveDevice: "перенос устройства",
  setDeviceStatus: "смена статуса устройства",
  attachComponent: "установка компонента",
  detachComponent: "снятие компонента",
  updateVendor: "изменение вендора",
  updateSupplier: "изменение поставщика",
  updateModel: "изменение модели",
  updateDeviceType: "изменение типа",
  updateGroup: "изменение группы",
  updateAttribute: "изменение атрибута",
  updateTypeAttribute: "изменение атрибута у типа",
  unlinkAttribute: "снятие атрибута с типа",
  updateConfiguration: "изменение конфигурации",
  updateBuild: "изменение шаблона сборки",
  mergeVendors: "слияние вендоров",
  mergeSuppliers: "слияние поставщиков",
  mergeGroups: "слияние групп",
  mergeModels: "слияние моделей",
  mergeAttributes: "слияние атрибутов",
  mergeConfigurations: "слияние конфигураций",
  mergeDeviceTypes: "слияние типов",
  retireVendor: "скрытие вендора",
  retireSupplier: "скрытие поставщика",
  retireModel: "скрытие модели",
  retireAttribute: "скрытие атрибута",
  retireDeviceType: "скрытие типа",
  deleteGroup: "удаление группы",
};

const isPlain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const rightLabel = (statement) => RIGHT_LABELS[Object.keys(statement)[0]] || JSON.stringify(statement);

function createProposals({ store, ops, now = () => new Date() }) {
  const withLock = createKeyLock();

  async function propose(input, caller) {
    // reasons: фразы HD; чужой текст — в quoted; error — строка для совместимости
    const refuse = (errors) => {
      const reasons = [].concat(errors).map((r) => (typeof r === "string" ? { text: r } : r));
      return { ok: false, error: reasons.map((r) => (r.quoted ? `${r.text}: ${r.quoted}` : r.text)).join("; "), reasons };
    };
    if (!isPlain(input)) return refuse("proposal must be an object");
    if (!caller || !caller.keyId) return refuse("caller (MCP key) is required");

    const errors = [];
    const telegramId = typeof input.requester === "number" ? String(input.requester) : input.requester;
    if (typeof telegramId !== "string" || !/^\d{1,20}$/.test(telegramId)) errors.push("requester must be the Telegram id of an employee (digits)");
    const title = checkText("title", input.title, MAX_TITLE, errors);
    const reason = checkText("reason", input.reason, MAX_REASON, errors);
    const operations = input.operations;
    if (!Array.isArray(operations) || !operations.length) errors.push("operations must be a non-empty list");
    else if (operations.length > MAX_OPERATIONS) errors.push(`too many operations (${operations.length}): at most ${MAX_OPERATIONS} per proposal`);

    // Дальше всё под замком ключа: пределы считаются и пишутся без гонки
    return withLock(`key:${caller.keyId}`, async () => {
      const at = now();
      let requester = null;
      if (!errors.some((e) => e.startsWith("requester"))) {
        requester = await store.findUserByTelegram(telegramId);
        if (requester?.error) errors.push(requester.error);
        else if (!requester) errors.push("no employee with this Telegram id: the person must be an active, non-banned staff member with a linked Telegram");
      }
      const listOk = Array.isArray(operations) && operations.length > 0 && operations.length <= MAX_OPERATIONS;

      // Права раньше проверки пакета (дёшево), но отказ отдаёт всё сразу
      if (requester && !requester.error && listOk) {
        const KINDS = ops.KINDS || {};
        for (let i = 0; i < operations.length; i++) {
          const def = isPlain(operations[i]) && Object.hasOwn(KINDS, operations[i].kind) ? KINDS[operations[i].kind] : null;
          // right вида — одно утверждение или список: отказ на каждое недостающее
          const statements = [...new Map([def?.right].flat().filter(Boolean).map((r) => [JSON.stringify(r), r])).values()];
          for (const statement of statements) {
            if (!(await store.canFor(requester, statement))) {
              errors.push(`Операция ${i + 1} (${KIND_LABELS[operations[i].kind] || operations[i].kind}): нет права «${rightLabel(statement)}»`);
            }
          }
        }
      }
      let items = [];
      if (listOk) {
        const checked = await ops.checkPackage(operations, { userId: requester?._id, now: at });
        errors.push(...checked.reasons);
        items = checked.items;
      }

      if (requester && !requester.error) {
        if ((await store.countOpen(requester._id)) >= MAX_OPEN) errors.push(`too many open proposals for this requester (${MAX_OPEN}): wait until some are decided`);
        if ((await store.countByKeySince(caller.keyId, new Date(at.getTime() - DAY_MS))) >= MAX_PER_DAY) errors.push(`too many proposals from this key in the last 24 hours (${MAX_PER_DAY})`);
      }
      if (errors.length) return refuse(errors);

      const doc = {
        number: await store.nextNumber(),
        title,
        reason,
        requestedBy: requester._id,
        requestedVia: { keyId: caller.keyId, keyName: caller.keyName },
        operations: items.map((item) => ({
          kind: item.kind,
          ...(item.ref ? { ref: item.ref } : {}),
          params: item.params,
          text: item.text,
          // Вид для страницы портала; предложения до него — без page (страница берёт text)
          ...(item.page ? { page: item.page } : {}),
          targets: item.targets,
          ...(item.componentIds ? { componentIds: item.componentIds } : {}),
          ...(item.componentRefs ? { componentRefs: item.componentRefs } : {}),
          // Снимок ссылок (renameOptions, слияния): применение идёт ровно по нему
          ...(item.refs ? { refs: item.refs } : {}),
          result: { state: "pending" },
        })),
        status: STATUS.awaitingRequester,
        expiresAt: new Date(at.getTime() + TTL_MS),
        timeline: [{ at, kind: "proposed", user: requester._id, text: "Предложено ИИ-агентом" }],
      };
      return { ok: true, change: await store.create(doc) };
    });
  }
  return { propose };
}

// --- Единственное место с моделями; подключаются лениво, чтобы модуль грузился без базы ---

const mongoStore = {
  // Полный документ сотрудника: по нему canFor считает права
  async findUserByTelegram(id) {
    return require("@/services/mcp/requester").findStaffByTelegram(id);
  },
  async canFor(user, statement) {
    const { canFor } = require("@/services/permissions");
    return Boolean((await canFor(user))(statement));
  },
  async countOpen(userId) {
    const InventoryChange = require("@/models/inventory/inventoryChange");
    return InventoryChange.countDocuments({ requestedBy: userId, status: { $in: Object.values(STATUS).filter(isOpen) } });
  },
  async countByKeySince(keyId, since) {
    const InventoryChange = require("@/models/inventory/inventoryChange");
    return InventoryChange.countDocuments({ "requestedVia.keyId": keyId, createdAt: { $gte: since } });
  },
  async nextNumber() {
    return require("@/models/inventory/inventoryChange").nextInventoryChangeNumber();
  },
  async create(doc) {
    const created = await require("@/models/inventory/inventoryChange").create(doc);
    return created.toObject();
  },
};

module.exports = { createProposals, mongoStore, RIGHT_LABELS, rightLabel, MAX_OPERATIONS, MAX_OPEN, MAX_PER_DAY, MAX_TITLE, MAX_REASON };
