// Операции пакета над устройствами: создание, правка, выдача, перенос,
// статус, установка и снятие детали. Проверки и записи — deviceOps (Task 1–2);
// здесь имена полей агента, каскад по снимку и текст с именами.
const { FIELD_LABELS, PENDING, field, entity, parseEntity, isId, blank, defineKind } = require("./kit");

const DEVICE_RIGHT = { device: ["manage"] };

// Зеркало DEVICE_STATUS_META (frontend/src/components/app/device-status.jsx)
const STATUS_LABELS = {
  readyForDeployment: "Готово к выдаче",
  deployed: "В эксплуатации",
  inReserve: "В резерве",
  inRepair: "В ремонте",
  decommissioned: "Списано",
  disposed: "Утилизировано",
};
const STATUSES = Object.keys(STATUS_LABELS);

// Тип простого поля устройства (остальные — строки)
const TYPE_OF = {
  quantity: "number",
  price: "number",
  purchasedAt: "date",
  warrantyExpirationDate: "date",
  lastMaintenanceDate: "date",
  deploymentDate: "date",
  nextMaintenanceDate: "date",
};
const plain = (name) => field(name, { type: TYPE_OF[name] ?? "string" });

const status = (name, opts) => field(name, { oneOf: STATUSES, oneOfLabel: "статус", ...opts });

// Тело POST /client-devices/add — имена как у формы (buildDevicePayload)
const CREATE_FIELDS = [
  entity("deviceModelId", "model"),
  entity("configurationId", "configuration"),
  entity("deviceTypeId", "type"),
  entity("companyId", "company"),
  entity("locationId", "location"),
  entity("userId", "user"),
  entity("buildId", "build"),
  entity("parentDeviceId", "device", { label: "устройство-хост" }),
  entity("supplierId", "supplier"),
  status("status"),
  ...[
    "inventoryNumber",
    "serialNumber",
    "hostname",
    "ipAddress",
    "macAddress",
    "operatingSystem",
    "quantity",
    "purchasedAt",
    "price",
    "purchaseDocument",
    "warrantyExpirationDate",
    "lastMaintenanceDate",
    "notes",
  ].map(plain),
  field("parts", {
    list: [
      entity("typeId", "type", { required: true }),
      entity("deviceModelId", "model", { required: true }),
      entity("configurationId", "configuration"),
      plain("serialNumber"),
      plain("purchasedAt"),
      plain("warrantyExpirationDate"),
      entity("supplierId", "supplier"),
    ],
  }),
];

// Белый список updateDevice (patchDevice)
const PATCH_FIELDS = [
  ...[
    "serialNumber",
    "inventoryNumber",
    "hostname",
    "ipAddress",
    "operatingSystem",
    "purchasedAt",
    "price",
  ].map(plain),
  entity("supplierId", "supplier"),
  ...["purchaseDocument", "warrantyExpirationDate", "deploymentDate", "nextMaintenanceDate", "comment"].map(plain),
  entity("configurationId", "configuration"),
];

// Значение поля в тексте: сущность — по имени, статус — подписью
const valueText = (t, path, value) => {
  if (t.view[path]) return t.show(path);
  if (path === "status") return `«${STATUS_LABELS[value] ?? value}»`;
  return `«${String(value)}»`;
};

// Значение поля в табличке страницы: как в тексте, но без кавычек
const valuePlain = (t, path, value) => {
  const v = t.view[path];
  if (v) return `${v.name}${v.pending ? PENDING : ""}`;
  if (path === "status") return STATUS_LABELS[value] ?? String(value);
  return String(value);
};

// Прежнее значение поля устройства (сырое из документа) -> строка | null:
// сущность — по имени, календарная дата — днём (лежит UTC-полночью)
const beforePlain = async (f, raw, describe) => {
  if (blank(raw)) return null;
  if (f.entity) return (await describe(f.entity.model, String(raw)))?.name ?? null;
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw.toISOString().slice(0, 10);
  return String(raw);
};

// Хвост каскада: детали по именам из снимка (или из состава, выведенного по
// пакету); хост — ссылка или состав не вывести — так и сказано
const UNKNOWN_PARTS = " вместе со всеми деталями";
const cascadeText = (t) => {
  if (t.params.withComponents === false) return "";
  if (t.parts.length) return ` вместе с деталями: ${t.parts.join(", ")}`;
  return t.partsUnknown ? UNKNOWN_PARTS : "";
};

// Деталь берёт у хоста компанию, помещение, пользователя и статус
const FROM_HOST = new Set(["companyId", "locationId", "userId", "status"]);
const FROM_HOST_TEXT = "компания, помещение, пользователь и статус — как у хоста";

// Что за новое устройство: модель или «типа X»
const createWhat = (t) =>
  t.view.deviceModelId ? t.show("deviceModelId") : t.view.deviceTypeId ? `типа ${t.show("deviceTypeId")}` : "";

// Заданные поля нового устройства в порядке CREATE_FIELDS, без модели, типа
// и деталей; у детали (в составе хоста) — без того, что берётся у хоста
// (другое значение отвергает проверка сервиса). skip — ещё пропустить.
// -> [{ name, value, hostNote }]
const createDetails = (t, skip = []) => {
  const inHost = Boolean(t.view.parentDeviceId);
  const out = [];
  for (const f of CREATE_FIELDS) {
    const value = t.params[f.name];
    if (f.name === "parts" || ["deviceModelId", "deviceTypeId", ...skip].includes(f.name)) continue;
    if (inHost && FROM_HOST.has(f.name)) continue;
    if (value === undefined || value === null || value === "") continue;
    out.push({ name: f.name, value, hostNote: f.name === "parentDeviceId" ? ` (${FROM_HOST_TEXT})` : "" });
  }
  return out;
};

// Опции каскада: при предложении — исключения агента, при применении — ровно
// снимок деталей из предложения (исключения в нём уже учтены; детали, которые
// создал пакет, applyPackage дописал в componentIds по ссылкам).
const cascadeOptions = (args, ctx) => ({
  actorId: ctx.userId,
  withComponents: args.withComponents ?? true,
  ...(ctx.componentIds ? { componentIds: ctx.componentIds } : { exceptComponentIds: args.exceptComponentIds ?? [] }),
});

const CASCADE_FIELDS = [field("withComponents", { type: "boolean" }), field("exceptComponentIds", { ids: true })];

module.exports = (deps) => {
  const ops = deps.deviceOps;
  const actor = (ctx) => ({ actorId: ctx.userId });

  // Имя детали, которую создаёт более ранняя операция пакета: «новая деталь
  // <модель или тип> «<номер>»»
  const newPartName = async (params, ctx) => {
    let what = "";
    for (const [key, model, refKind] of [
      ["deviceModelId", "DeviceModel", "model"],
      ["deviceTypeId", "DeviceType", "type"],
    ]) {
      const parsed = parseEntity(params?.[key]);
      if (parsed?.id) what = (await deps.describe(model, parsed.id))?.name ?? "";
      else if (parsed?.ref) {
        const entry = ctx.pending?.get(parsed.ref);
        what = entry ? entry.def.label(entry.params, parsed.key, refKind) : "";
      }
      if (what) break;
    }
    const number = params?.inventoryNumber || params?.serialNumber;
    return ["новая деталь", what, number ? `«${number}»` : ""].filter(Boolean).join(" ");
  };

  // Состав хоста к моменту отложенной операции с каскадом: живые детали в
  // базе, затем более ранние операции пакета по порядку — установка в этот
  // хост добавляет деталь, снятие с него или установка в другой убирает,
  // новая деталь этого хоста (createDevice с parentDeviceId) добавляется
  // ссылкой; затем исключения агента. Других способов сменить состав у
  // операций нет. Новая деталь без ref — null: её id при применении не найти,
  // «вместе со всеми деталями».
  // -> [{ id } | { ref, name }] | null
  const expectedParts = async (params, ctx) => {
    if (!deps.liveParts || !isId(params.device)) return null;
    const host = params.device;
    const parts = new Map();
    for (const id of await deps.liveParts(host)) parts.set(String(id), { id: String(id) });
    const earlier = ctx.earlier ?? [];
    const createdParams = new Map(earlier.filter((op) => op.kind === "createDevice" && op.ref).map((op) => [op.ref, op.params]));
    for (const op of earlier) {
      const p = op.params ?? {};
      if (op.kind === "createDevice") {
        if (p.parentDeviceId !== host) continue;
        if (!op.ref) return null;
        parts.set(`ref:${op.ref}`, { ref: op.ref, params: p });
        continue;
      }
      if (op.kind !== "attachComponent" && op.kind !== "detachComponent") continue;
      const component = parseEntity(p.component);
      if (!component) continue;
      const key = component.id ?? `ref:${component.ref}`;
      if (op.kind === "attachComponent" && p.host === host) {
        parts.set(key, component.id ? { id: component.id } : { ref: component.ref, params: createdParams.get(component.ref) });
      } else if (op.kind === "attachComponent" || p.host === host) {
        parts.delete(key);
      }
    }
    const except = new Set((params.exceptComponentIds ?? []).map(String));
    const out = [];
    for (const part of parts.values()) {
      if (part.id) {
        if (!except.has(part.id)) out.push({ id: part.id });
      } else {
        out.push({ ref: part.ref, name: await newPartName(part.params, ctx) });
      }
    }
    return out;
  };

  const createDevice = defineKind(
    {
      right: DEVICE_RIGHT,
      refKinds: ["device"],
      fields: CREATE_FIELDS,
      label: (params) => {
        const number = params?.inventoryNumber || params?.serialNumber;
        return number ? `устройство ${number}` : "новое устройство";
      },
      // Путь агента: поверх проверок портала — поля как у формы, правила
      // установки детали в хост, помещение и конфигурация модели
      service: {
        check: (args) => ops.checkAgentDevice(args),
        apply: (args, ctx) => ops.createAgentDevice(args, { userId: ctx.userId }),
      },
      created: (result) => ({ created: { device: String(result.device._id) } }),
      text: (t) => {
        const details = createDetails(t).map(
          ({ name, value, hostNote }) => `${FIELD_LABELS[name]} ${valueText(t, name, value)}${hostNote}`,
        );
        // Детали своей сборки — по строке на каждую: в Telegram это подстроки операции
        const parts = (t.params.parts ?? []).map((part, i) => {
          const serial = typeof part?.serialNumber === "string" && part.serialNumber ? `, серийный номер «${part.serialNumber}»` : "";
          return `деталь ${t.show(`parts[${i}].deviceModelId`)}${serial}`;
        });
        const head = `Новое устройство ${createWhat(t)}`.trim() + (details.length ? `: ${details.join(", ")}` : "");
        return [head, ...parts];
      },
      // Страница: модель и конфигурация — в заголовке, поля — табличкой (без
      // кавычек); инвентарный номер не задан — его выдаст HD (последней
      // строкой). Детали своей сборки остаются подстроками текста.
      page: (t) => {
        const config = t.view.configurationId ? `, конфигурация ${t.show("configurationId")}` : "";
        const fields = createDetails(t, ["configurationId"]).map(({ name, value, hostNote }) => ({
          label: FIELD_LABELS[name],
          value: `${valuePlain(t, name, value)}${hostNote}`,
        }));
        if (blank(t.params.inventoryNumber)) fields.push({ label: FIELD_LABELS.inventoryNumber, value: "выдаст HD" });
        return { head: `Новое устройство ${createWhat(t)}`.trim() + config, fields };
      },
    },
    deps,
  );

  const updateDevice = defineKind(
    {
      right: DEVICE_RIGHT,
      refKinds: [],
      fields: [entity("device", "device", { required: true }), ...PATCH_FIELDS],
      validate: (params) => (Object.keys(params).some((key) => key !== "device") ? [] : ["нет полей для изменения"]),
      service: {
        check: ({ device, ...patch }, ctx) => ops.checkPatchDevice(device, patch, actor(ctx)),
        apply: ({ device, ...patch }, ctx) => ops.patchDevice(device, patch, actor(ctx)),
      },
      text: (t) => {
        const changes = PATCH_FIELDS.filter((f) => Object.hasOwn(t.params, f.name)).map((f) => {
          const value = t.params[f.name];
          return value === null || value === ""
            ? `${FIELD_LABELS[f.name]} — очистить`
            : `${FIELD_LABELS[f.name]} → ${valueText(t, f.name, value)}`;
        });
        return `Изменить ${t.show("device")}: ${changes.join(", ")}`;
      },
      // Страница: строка на изменённое поле, «было» — из проверки сервиса
      // (у отложенной операции его нет)
      page: async (t) => {
        const before = t.checked?.before ?? {};
        const fields = [];
        for (const f of PATCH_FIELDS) {
          if (!Object.hasOwn(t.params, f.name)) continue;
          const value = t.params[f.name];
          fields.push({
            label: FIELD_LABELS[f.name],
            value: value === null || value === "" ? "очистить" : valuePlain(t, f.name, value),
            before: await beforePlain(f, before[f.name], deps.describe),
          });
        }
        return { head: `Изменить ${t.show("device")}`, fields };
      },
    },
    deps,
  );

  const assignDevice = defineKind(
    {
      right: DEVICE_RIGHT,
      refKinds: [],
      fields: [
        entity("device", "device", { required: true }),
        entity("user", "user", { required: true, nullable: true }),
        ...CASCADE_FIELDS,
      ],
      cascade: true,
      expectedParts,
      service: {
        check: (args, ctx) => ops.checkAssignUser(args.device, args.user ?? null, cascadeOptions(args, ctx)),
        apply: (args, ctx) => ops.assignUser(args.device, args.user ?? null, cascadeOptions(args, ctx)),
      },
      text: (t) =>
        (t.view.user ? `Выдать ${t.show("device")}: ${t.show("user")}` : `Снять пользователя с ${t.show("device")}`) +
        cascadeText(t),
    },
    deps,
  );

  const moveDevice = defineKind(
    {
      right: DEVICE_RIGHT,
      refKinds: [],
      fields: [
        entity("device", "device", { required: true }),
        entity("location", "location", { required: true, nullable: true }),
        ...CASCADE_FIELDS,
      ],
      cascade: true,
      expectedParts,
      service: {
        check: (args, ctx) => ops.checkMoveDevice(args.device, args.location ?? null, cascadeOptions(args, ctx)),
        apply: (args, ctx) => ops.moveDevice(args.device, args.location ?? null, cascadeOptions(args, ctx)),
      },
      text: (t) =>
        (t.view.location
          ? `Перенести ${t.show("device")} в ${t.show("location")}`
          : `Снять помещение у ${t.show("device")}`) + cascadeText(t),
    },
    deps,
  );

  const setDeviceStatus = defineKind(
    {
      right: DEVICE_RIGHT,
      refKinds: [],
      fields: [entity("device", "device", { required: true }), status("status", { required: true }), ...CASCADE_FIELDS],
      cascade: true,
      expectedParts,
      service: {
        check: (args, ctx) => ops.checkSetDeviceStatus(args.device, args.status, cascadeOptions(args, ctx)),
        apply: (args, ctx) => ops.setDeviceStatus(args.device, args.status, cascadeOptions(args, ctx)),
      },
      text: (t) => `Сменить статус ${t.show("device")} на «${STATUS_LABELS[t.params.status]}»` + cascadeText(t),
      // Страница: заголовок — текст (с хвостом каскада), статус «было → стало»
      page: (t) => {
        const was = t.checked?.before?.status;
        return {
          fields: [
            {
              label: FIELD_LABELS.status,
              value: STATUS_LABELS[t.params.status],
              before: blank(was) ? null : (STATUS_LABELS[was] ?? String(was)),
            },
          ],
        };
      },
    },
    deps,
  );

  const componentKind = (check, apply, text) =>
    defineKind(
      {
        right: DEVICE_RIGHT,
        refKinds: [],
        fields: [
          entity("host", "device", { label: "устройство-хост", required: true }),
          entity("component", "device", { label: "комплектующее", required: true }),
        ],
        service: {
          check: (args, ctx) => ops[check](args.host, args.component, actor(ctx)),
          apply: (args, ctx) => ops[apply](args.host, args.component, actor(ctx)),
        },
        text,
      },
      deps,
    );

  const attachComponent = componentKind(
    "checkAttachComponent",
    "attachComponent",
    (t) => `Установить ${t.show("component")} в ${t.show("host")}`,
  );
  const detachComponent = componentKind(
    "checkDetachComponent",
    "detachComponent",
    (t) => `Снять ${t.show("component")} с ${t.show("host")}`,
  );

  return {
    createDevice,
    updateDevice,
    assignDevice,
    moveDevice,
    setDeviceStatus,
    attachComponent,
    detachComponent,
  };
};

module.exports.STATUS_LABELS = STATUS_LABELS;
