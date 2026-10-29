const mongoose = require("mongoose");

const ClientDevice = require("../../models/inventory/clientDevice");
const Company = require("../../models/company");
const User = require("../../models/user");
const DeviceModel = require("../../models/inventory/deviceModel");
const DeviceType = require("../../models/inventory/deviceType");
const Counter = require("../../models/inventory/counter");
const DeviceBuild = require("../../models/inventory/deviceBuild");
const DeviceConfiguration = require("../../models/inventory/deviceConfiguration");
const Location = require("../../models/inventory/location");
const DeviceTypeAttribute = require("../../models/inventory/deviceTypeAttribute");
const { isAttachableType } = require("./attachRules");
const {
  configurationForDevice,
  soleConfigurationId,
} = require("./modelConfigurations");
const { validationResult } = require("express-validator");
const {
  clientDeviceValidation,
} = require("../../validations/inventory/clientDevice");

const {
  loadAssemblyType,
  parseBuildParts,
  resolveParts,
} = require("../../controllers/inventory/deviceBuild");
const { AppError } = require("../../middleware/errorHandling");
const {
  normalizeDeviceAttributes,
  missingRequired,
  loadDeviceLinks,
} = require("./deviceAttributes");
const {
  FIELD_BY_KEY,
  planSystemValues,
  systemIds,
  systemPatchOf,
  systemValues,
} = require("./systemDeviceAttributes");
const logger = require("../../utils/logger");

// Mongoose can't cast "" to ObjectId / Number / Date — turn blanks into
// undefined so empty optional fields are stored as unset rather than throwing.
const clean = (value) =>
  value === "" || value === undefined ? undefined : value;

// Maps the (schema-aligned) request body onto ClientDevice fields.
const buildDevicePayload = (body) => ({
  companyId: clean(body.companyId),
  userId: clean(body.userId),
  locationId: clean(body.locationId),
  deviceModelId: clean(body.deviceModelId),
  configurationId: clean(body.configurationId),
  deviceTypeId: clean(body.deviceTypeId),
  buildId: clean(body.buildId),
  parentDeviceId: clean(body.parentDeviceId),
  quantity: clean(body.quantity),
  // clean(): пустой серийник сохраняем как unset (не ""), иначе пустые строки
  // конфликтуют по партиал-уникальному индексу.
  serialNumber: clean(body.serialNumber),
  inventoryNumber: clean(body.inventoryNumber),
  status: clean(body.status),
  purchasedAt: clean(body.purchasedAt),
  price: clean(body.price),
  purchaseDocument: clean(body.purchaseDocument),
  supplierId: clean(body.supplierId),
  warrantyExpirationDate: clean(body.warrantyExpirationDate),
  lastMaintenanceDate: clean(body.lastMaintenanceDate),
  // Сетевое имя ПК. machineId здесь НЕ маппим намеренно: его проставляет агент
  // отдельным путём, а update делает Object.assign(payload) — иначе правка из
  // мастера (без machineId в теле) затёрла бы значение агента.
  hostname: clean(body.hostname),
  notes: clean(body.notes),
});

// Префикс инвентарного номера берём из типа устройства
// (DeviceType.inventoryPrefix), иначе — дефолтный "INV". Формат: PREFIX-000001,
// счётчик ведётся отдельно на каждый префикс.
const generateInventoryNumber = async (deviceTypeId) => {
  let prefix = "INV";
  if (deviceTypeId) {
    const type =
      await DeviceType.findById(deviceTypeId).select("inventoryPrefix");
    if (type?.inventoryPrefix) prefix = type.inventoryPrefix;
  }
  const seq = await Counter.getNextSequence(`clientDevice:${prefix}`);
  return `${prefix}-${String(seq).padStart(6, "0")}`;
};

// ─── ПК своей сборки: детали при создании ─────────────────────────────────
//
// Деталь — отдельный ClientDevice внутри ПК, одна запись на единицу (у каждой
// свой серийник). Правила слотов — те же, что у сборки-шаблона
// (parseBuildParts): единица идёт туда с quantity 1, и второй экземпляр в
// слоте без «несколько» отсекается так же, как вторая строка сборки.

const PART_DATE_FIELDS = ["warrantyExpirationDate", "purchasedAt"];

const isValidDate = (value) => !Number.isNaN(new Date(value).getTime());

// Разбор деталей нового ПК. Чистая функция: slots — как у loadAssemblyType.
// Пустой список законен (ПК без деталей) — обязательные слоты тогда не
// проверяются. Порядок результата — порядок слотов, внутри слота — как прислано.
function planDeviceParts(parts, slots) {
  if (parts == null || (Array.isArray(parts) && parts.length === 0)) {
    return { parts: [] };
  }
  if (!Array.isArray(parts)) {
    return { error: "parts должен быть массивом" };
  }

  const parsed = parseBuildParts(
    parts.map((item) => ({
      typeId: item?.typeId,
      deviceModelId: item?.deviceModelId,
      configurationId: clean(item?.configurationId),
      quantity: 1,
    })),
    slots,
  );
  if (parsed.error) return parsed;

  // parseBuildParts упорядочил по слотам, сохранив порядок внутри слота, —
  // тот же стабильный порядок у исходных строк, чтобы сопоставить их по номеру.
  const slotIndex = new Map(slots.map((s, i) => [String(s.typeId), i]));
  const typeName = new Map(slots.map((s) => [String(s.typeId), s.typeName]));
  const ordered = [...parts].sort(
    (a, b) =>
      slotIndex.get(String(a.typeId)) - slotIndex.get(String(b.typeId)),
  );

  const result = [];
  for (const [i, item] of ordered.entries()) {
    const unit = parsed.parts[i];
    const name = typeName.get(unit.typeId);
    const part = {
      typeId: unit.typeId,
      deviceModelId: unit.deviceModelId,
      configurationId: unit.configurationId,
    };
    // Предел — как у серийника устройства (validations/inventory/clientDevice)
    const serialNumber = String(item.serialNumber ?? "").trim();
    if (serialNumber.length > 100) {
      return { error: `Серийный номер детали «${name}» длиннее 100 символов` };
    }
    if (serialNumber) part.serialNumber = serialNumber;
    for (const field of PART_DATE_FIELDS) {
      const value = clean(item[field]);
      if (value == null) continue;
      if (!isValidDate(value)) {
        return { error: `Неверная дата в детали «${name}»` };
      }
      part[field] = value;
    }
    const supplierId = clean(item.supplierId);
    if (supplierId != null) {
      if (!mongoose.isValidObjectId(supplierId)) {
        return { error: `Неверный поставщик в детали «${name}»` };
      }
      part.supplierId = String(supplierId);
    }
    result.push(part);
  }
  return { parts: result };
}

// Документ детали: следует за ПК (компания, место, пользователь, статус — как
// при прикреплении). «Закупка как у ПК»: своя дата или свой поставщик заданы —
// закупка детали своя целиком, иначе дата и поставщик берутся у ПК.
const partPayload = (part, host) => {
  const ownPurchase = part.purchasedAt != null || part.supplierId != null;
  return buildDevicePayload({
    deviceModelId: part.deviceModelId,
    configurationId: part.configurationId,
    serialNumber: part.serialNumber,
    warrantyExpirationDate: part.warrantyExpirationDate,
    purchasedAt: ownPurchase ? part.purchasedAt : host.purchasedAt,
    supplierId: ownPurchase ? part.supplierId : host.supplierId,
    parentDeviceId: host._id,
    companyId: host.companyId,
    locationId: host.locationId,
    userId: host.userId,
    status: host.status,
    quantity: 1,
  });
};

/**
 * Занятые идентификаторы устройства: инвентарный номер (уникален глобально) и
 * имя в сети (уникально в пределах компании). Проверяется то, что передано;
 * excludeId — само устройство при правке. Возвращает { status, message } | null.
 */
const findTakenIdentity = async ({
  inventoryNumber,
  hostname,
  companyId,
  excludeId,
}) => {
  const notSelf = excludeId ? { _id: { $ne: excludeId } } : {};
  if (inventoryNumber) {
    const invExists = await ClientDevice.findOne({
      inventoryNumber,
      ...notSelf,
    });
    if (invExists) {
      return {
        status: 409,
        message: `Устройство с инвентарным номером ${inventoryNumber} уже существует`,
      };
    }
  }
  if (hostname) {
    const hostExists = await ClientDevice.findOne({
      companyId,
      hostname,
      ...notSelf,
    });
    if (hostExists) {
      return {
        status: 409,
        message: `Устройство с именем "${hostname}" уже есть в этой компании`,
      };
    }
  }
  return null;
};

/**
 * Проверки нового устройства до записи: занятые инвентарный номер и имя в
 * сети, наследование от хозяина, компания, пользователь, модель или тип.
 * Возвращает { payload, deviceTypeId } | { error: AppError }.
 */
const validateNewDevice = async (payload) => {
  const takenInventory = await findTakenIdentity({
    inventoryNumber: payload.inventoryNumber,
  });
  if (takenInventory) {
    return {
      error: new AppError(takenInventory.message, takenInventory.status),
    };
  }

  // Компонент наследует компанию/расположение/пользователя от родителя.
  if (payload.parentDeviceId) {
    const parent = await ClientDevice.findById(payload.parentDeviceId);
    if (!parent) {
      return { error: new AppError("Invalid parent device ID", 400) };
    }
    payload.companyId = payload.companyId || parent.companyId;
    payload.locationId = payload.locationId || parent.locationId;
    payload.userId = payload.userId || parent.userId;
  }

  const company = await Company.findById(payload.companyId);
  if (!company) {
    return { error: new AppError("Invalid company ID", 400) };
  }

  // Hostname опционален и уникален в пределах компании — проверяем дубль,
  // только если задан (companyId здесь уже разрешён, в т.ч. от родителя).
  const takenHostname = await findTakenIdentity({
    hostname: payload.hostname,
    companyId: payload.companyId,
  });
  if (takenHostname) {
    return { error: new AppError(takenHostname.message, takenHostname.status) };
  }

  // Назначенный пользователь должен быть из компании устройства (company у
  // User — вложенный объект { _id, alias }; сравниваем по _id).
  if (payload.userId) {
    const user = await User.findById(payload.userId);
    const userCompanyId = user?.company?._id || user?.company;
    if (!user || userCompanyId?.toString() !== payload.companyId?.toString()) {
      return {
        error: new AppError(
          "Assigned user must belong to the same company",
          400,
        ),
      };
    }
  }

  // Устройство задаётся либо моделью (заводская сборка), либо напрямую типом
  // (самосборное). Тип нужен и для префикса инвентарного номера.
  if (payload.deviceModelId) {
    const deviceModel = await DeviceModel.findById(payload.deviceModelId);
    if (!deviceModel) {
      return { error: new AppError("Invalid device model ID", 400) };
    }
    // Не прислана — единственная конфигурация модели (режим одной)
    payload.configurationId = configurationForDevice(
      payload.configurationId,
      payload.configurationId ? null : await soleConfigurationId(deviceModel._id),
    );
    return { payload, deviceTypeId: deviceModel.deviceTypeId };
  }
  if (payload.deviceTypeId) {
    const deviceType = await DeviceType.findById(payload.deviceTypeId);
    if (!deviceType) {
      return { error: new AppError("Invalid device type ID", 400) };
    }
    // Своя сборка (без модели) — только у типа, который собирается из
    // комплектующих; деталь (с родителем) по-прежнему может быть без модели.
    if (!payload.parentDeviceId && !deviceType.assembly?.enabled) {
      return {
        error: new AppError(
          `Тип «${deviceType.name}» не собирается из комплектующих — укажите модель`,
          400,
        ),
      };
    }
    return { payload, deviceTypeId: payload.deviceTypeId };
  }
  return { error: new AppError("Укажите модель или тип устройства", 400) };
};

// Сборка-шаблон устройства: только у «Своей сборки» собираемого типа, своего
// типа и не удалённая. Возвращает { slots } | { error: AppError }.
const validateAssembly = async (payload) => {
  if (payload.deviceModelId) {
    return {
      error: new AppError(
        "Сборка и комплектующие — только у своей сборки, не у заводского устройства",
        400,
      ),
    };
  }
  if (payload.parentDeviceId) {
    return {
      error: new AppError(
        "Деталь сборки сама из комплектующих не собирается",
        400,
      ),
    };
  }
  const loaded = await loadAssemblyType(payload.deviceTypeId);
  if (loaded.error) return { error: loaded.error };
  if (payload.buildId) {
    const build = mongoose.isValidObjectId(payload.buildId)
      ? await DeviceBuild.exists({
          _id: payload.buildId,
          deviceTypeId: payload.deviceTypeId,
          deletedAt: null,
        })
      : null;
    if (!build) {
      return {
        error: new AppError("Сборка не найдена или другого типа", 400),
      };
    }
  }
  return { slots: loaded.slots };
};

// Детали нового ПК: слоты, обязательные, «несколько», модели и конфигурации —
// всё до первой записи. Возвращает { parts } | { error: AppError }.
const prepareParts = async (rawParts, slots) => {
  const planned = planDeviceParts(rawParts, slots);
  if (planned.error) return { error: new AppError(planned.error, 400) };
  if (planned.parts.length === 0) return { parts: [] };
  return resolveParts(planned.parts);
};

// Откат создания: удаление строго по списку созданных _id — сначала детали,
// затем ПК. Сбой отката не заслоняет исходную ошибку.
const rollbackCreated = async (host, parts) => {
  try {
    if (parts.length) {
      await ClientDevice.deleteMany({ _id: { $in: parts.map((p) => p._id) } });
    }
    if (host) await ClientDevice.deleteOne({ _id: host._id });
  } catch (rollbackError) {
    logger.log("error", "Client device create rollback failed", {
      hostId: host?._id ? String(host._id) : null,
      partIds: parts.map((p) => String(p._id)),
      error: rollbackError.message,
    });
  }
};

// Эффективный тип устройства: у заводской сборки берём из модели, у самосборной —
// напрямую. Принимает «сырой» документ (deviceModelId/deviceTypeId — ObjectId).
const getEffectiveTypeId = async (device) => {
  if (device.deviceModelId) {
    const model =
      await DeviceModel.findById(device.deviceModelId).select("deviceTypeId");
    return model?.deviceTypeId || null;
  }
  return device.deviceTypeId || null;
};

/**
 * E11000 → человеческая 409 вместо «Failed to add device» с 500.
 *
 * Уникальны инвентарный номер, имя в сети (в пределах компании) и machineId —
 * конфликт по ним означает ровно одно: значение уже занято. Серийника здесь нет
 * намеренно: он не уникален (см. модель). Конфликт по другому полю — значит,
 * в базе остался индекс, которого в модели нет, и ответ должен его назвать.
 */
const DUPLICATE_FIELDS = {
  inventoryNumber: "инвентарным номером",
  hostname: "именем устройства",
  machineId: "идентификатором машины",
};

const duplicateError = (error) => {
  if (error?.code !== 11000) return null;
  const field = Object.keys(error.keyPattern || {}).find(
    (key) => DUPLICATE_FIELDS[key],
  );
  if (!field) {
    // Индекс не из модели — называем поле, а не отдаём «Такая запись уже существует»
    const stale = Object.keys(error.keyPattern || {}).join(", ");
    return {
      status: 409,
      message: `Конфликт уникальности по полю «${stale}»: в базе индекс, которого нет в модели.`,
    };
  }
  const value = error.keyValue?.[field];
  if (value == null) {
    return {
      status: 409,
      message: `В базе устаревший уникальный индекс по полю «${field}»: второе устройство без значения он не пропускает.`,
    };
  }
  return {
    status: 409,
    message: `Устройство с таким ${DUPLICATE_FIELDS[field]} (${value}) уже есть`,
  };
};


const fail = (status, message) => ({ ok: false, status, message });

// Отказ проверки: статус и текст те же, что отдавал контроллер.
const refusal = (error) => ({
  ok: false,
  status: error.statusCode,
  message: error.message,
});

/**
 * Все проверки нового устройства без единой записи: валидация полей, сборка,
 * детали. Возвращает { ok:true, plan:{ payload, deviceTypeId, parts } } |
 * { ok:false, status, message }.
 */
// requireAttributes — обязательные атрибуты устройства проверяются только на
// пути интерфейса: агент и автосоздание из Mikrotik ими не блокируются.
const checkNewDevice = async (body, { requireAttributes = false } = {}) => {
  const checked = await validateNewDevice(buildDevicePayload(body));
  if (checked.error) return refusal(checked.error);
  const { payload, deviceTypeId } = checked;

  const deviceLinks = await loadDeviceLinks(deviceTypeId);
  const attrs = normalizeDeviceAttributes(body.attributes, deviceLinks);
  if (attrs.error) return fail(400, attrs.error);
  if (requireAttributes) {
    const missing = missingRequired(deviceLinks, attrs.values);
    if (missing.length) return fail(400, `Не заполнено: ${missing.join(", ")}`);
  }
  payload.attributes = attrs.values;
  // ОС, IP и MAC агента (имена прежних полей) — в системные атрибуты; связки
  // с типом пишутся вместе с устройством
  const system = await planSystemValues(payload, systemPatchOf(body), {
    typeId: deviceTypeId,
  });
  if (system) payload.attributes = system.attributes;

  // ПК своей сборки собираемого типа может прийти со сборкой-шаблоном и
  // деталями. Без них — обычное устройство, как раньше.
  const rawParts = body.parts;
  const withParts = Array.isArray(rawParts)
    ? rawParts.length > 0
    : rawParts != null;
  let parts = [];
  if (payload.buildId || withParts) {
    const assembly = await validateAssembly(payload);
    if (assembly.error) return refusal(assembly.error);
    const prepared = await prepareParts(rawParts, assembly.slots);
    if (prepared.error) return refusal(prepared.error);
    parts = prepared.parts;
  }
  return {
    ok: true,
    plan: { payload, deviceTypeId, parts, links: system?.links ?? [] },
  };
};

// Записи нового устройства по проверенному плану. check — проверка, дающая
// план (портал или агент); stampUpdated — ещё и updatedBy (путь агента).
const writeDevice = async (check, { userId, stampUpdated = false } = {}) => {
  try {
    const checked = await check();
    if (!checked.ok) return checked;
    const { payload, deviceTypeId, parts, links = [] } = checked.plan;
    const author = {
      createdBy: userId,
      ...(stampUpdated ? { updatedBy: userId } : {}),
    };

    // Записи — только после всех проверок. Транзакций нет: сбой посреди
    // записи откатывается удалением созданного по списку _id.
    let host = null;
    const components = [];
    try {
      // Инвентарный номер — первичный идентификатор актива: если не задан
      // вручную, генерируем автоматически по префиксу типа.
      if (!payload.inventoryNumber) {
        payload.inventoryNumber = await generateInventoryNumber(deviceTypeId);
      }
      const clientDevice = new ClientDevice({
        ...payload,
        ...author,
      });
      await clientDevice.save();
      host = clientDevice;
      // Связки системных атрибутов с типом; при откате остаются — безвредны
      for (const link of links) await new DeviceTypeAttribute(link).save();

      // Номер детали — по префиксу её типа.
      for (const part of parts) {
        const component = new ClientDevice({
          ...partPayload(part, host),
          inventoryNumber: await generateInventoryNumber(part.typeId),
          ...author,
        });
        await component.save();
        components.push(component);
      }
    } catch (error) {
      await rollbackCreated(host, components);
      throw error;
    }

    return { ok: true, device: host, parts: components };
  } catch (error) {
    const duplicate = duplicateError(error);
    if (duplicate) return { ok: false, ...duplicate };
    return { ok: false, status: 500, message: "Failed to add device", error };
  }
};

/**
 * Создание устройства: checkNewDevice + записи. Возвращает
 * { ok:true, device, parts:[device] } | { ok:false, status, message }.
 * При непредвиденном сбое (500) в результате есть error — исходная ошибка.
 */
const createDevice = (body, { userId, requireAttributes = false } = {}) =>
  writeDevice(() => checkNewDevice(body, { requireAttributes }), { userId });

// ─── Путь агента: поля формы и правила, которых портал не проверяет ───────
//
// Портал проверяет поля express-validator'ом маршрута, а деталь ставит в хост
// отдельным шагом (attachComponent). Агент создаёт и правит через сервис —
// здесь те же цепочки валидации и те же правила установки детали.

const lowerFirst = (text) => text.charAt(0).toLowerCase() + text.slice(1);

/**
 * Цепочки clientDeviceValidation на поддельном запросе. fields — проверять
 * только эти поля (правка); без него — всё тело (создание). Причина называет
 * поле именем сервиса: «Поле «ipAddress»: …» — подпись подставляет реестр
 * операций (humanError). -> { ok:false, status:400, message } | null.
 */
const fieldErrors = async (body, fields = null) => {
  const req = { body: { ...body } };
  await Promise.all(clientDeviceValidation.map((chain) => chain.run(req)));
  const errors = validationResult(req)
    .array()
    .filter((error) => !fields || fields.includes(error.path));
  if (!errors.length) return null;
  const first = errors[0];
  return fail(400, `Поле «${first.path}»: ${lowerFirst(String(first.msg))}`);
};

// Правила установки детали в хост: тип прикрепляемый и, если ограничен
// списком хостов, совместим с типом хоста. -> fail(...) | null.
const attachTypeError = async (typeId, host) => {
  const type = typeId
    ? await DeviceType.findById(typeId).select(
        "isComponent isConsumable isPeripheral attachableToTypeIds",
      )
    : null;
  if (!isAttachableType(type, null)) {
    return fail(
      400,
      "Этот тип устройства нельзя прикреплять как комплектующее",
    );
  }
  // Тип ограничен списком хостов: без типа у хоста он тоже несовместим.
  if ((type.attachableToTypeIds || []).length) {
    const hostTypeId = await getEffectiveTypeId(host);
    if (!hostTypeId || !isAttachableType(type, hostTypeId)) {
      return fail(400, "Этот компонент несовместим с типом хоста");
    }
  }
  return null;
};

// Помещение: существует и той же компании, что устройство, либо общее
// (правило moveDevice). -> fail(...) | null.
const locationError = async (locationId, companyId) => {
  const location = mongoose.isValidObjectId(locationId)
    ? await Location.findById(locationId)
    : null;
  if (!location) return fail(400, "Помещение не найдено");
  if (String(location.company) !== String(companyId) && !location.isPublic) {
    return fail(
      400,
      "Помещение другой компании: перенос возможен только в общее помещение",
    );
  }
  return null;
};

// Конфигурация — пресет модели устройства (правило patchDevice). -> fail | null.
const configurationError = async (configurationId, deviceModelId) => {
  const configuration = mongoose.isValidObjectId(configurationId)
    ? await DeviceConfiguration.findById(configurationId)
    : null;
  if (
    !configuration ||
    configuration.deletedAt ||
    !deviceModelId ||
    String(configuration.deviceModelId) !== String(deviceModelId)
  ) {
    return fail(400, "Конфигурация не относится к модели устройства");
  }
  return null;
};

// Что деталь берёт у хоста (как planAttachComponent) и отказ, если агент
// указал другое значение
const FROM_HOST = [
  ["companyId", "Деталь получает компанию хоста — не указывайте другую"],
  ["locationId", "Деталь получает помещение хоста — не указывайте другое"],
  ["userId", "Деталь получает пользователя хоста — не указывайте другого"],
  ["status", "Деталь получает статус хоста — не указывайте другой"],
];

/**
 * Новое устройство от агента: поля как у формы, затем checkNewDevice, затем
 * правила, которые портал проверяет отдельными шагами. Деталь (parentDeviceId)
 * ставится в хост по правилам attachComponent — тип прикрепляемый и
 * совместимый, хост сам не деталь (один уровень) — и, как при прикреплении,
 * берёт у хоста компанию, помещение, пользователя и статус: не указанное
 * наследуется молча, указанное другое — отказ с названием поля.
 * Возвращает то же, что checkNewDevice.
 */
const checkAgentDevice = async (body) => {
  const invalid = await fieldErrors(body);
  if (invalid) return invalid;

  let host = null;
  let input = body;
  const parentId = clean(body.parentDeviceId);
  if (parentId) {
    host = mongoose.isValidObjectId(parentId)
      ? await ClientDevice.findById(parentId)
      : null;
    if (!host || host.deletedAt) {
      return fail(400, "Invalid parent device ID");
    }
    if (host.parentDeviceId) {
      return fail(
        400,
        "Устройство-хост само входит в сборку: деталь ставится только в устройство верхнего уровня",
      );
    }
    input = { ...body };
    for (const [field, message] of FROM_HOST) {
      const given = clean(body[field]);
      if (given != null && String(given).toLowerCase() !== String(host[field] ?? "").toLowerCase()) {
        return fail(400, message);
      }
      input[field] = host[field] ?? undefined;
    }
  }

  const checked = await checkNewDevice(input);
  if (!checked.ok) return checked;
  const { payload, deviceTypeId } = checked.plan;

  if (host) {
    const rule = await attachTypeError(deviceTypeId, host);
    if (rule) return rule;
  }

  // Помещение — только заданное агентом и не у детали (у неё — хостовое)
  if (!host && clean(body.locationId)) {
    const wrong = await locationError(payload.locationId, payload.companyId);
    if (wrong) return wrong;
  }
  if (payload.configurationId) {
    const wrong = await configurationError(
      payload.configurationId,
      payload.deviceModelId,
    );
    if (wrong) return wrong;
  }
  return checked;
};

// Создание от агента: checkAgentDevice + записи; автор — и в updatedBy.
const createAgentDevice = (body, { userId } = {}) =>
  writeDevice(() => checkAgentDevice(body), { userId, stampUpdated: true });

// ─── Правки существующего устройства ──────────────────────────────────────
//
// Каждая операция — пара: check* (всё то же, но ни одной записи) и сама
// операция. Обе строятся из общего плана: план проверяет и меняет документы
// в памяти, запись (save) делает только настоящая операция.
// Результат: { ok:true, device, affected:[_id] } | { ok:false, status, message }.
// В affected — те, кого затронул каскад (у attach/detach — деталь, у patch —
// само устройство).

const idList = (ids) => (ids || []).map(String);

// Живые детали хоста без исключённых. Удалённые каскад не трогает. Явный
// список componentIds (из снимка предложения) каскадирует ровно эти детали:
// каждая обязана быть живой деталью хоста, иначе 409 с названием детали.
// Возвращает { components } | { error: {status, message} }.
const liveComponents = async (host, exceptComponentIds, componentIds) => {
  const except = new Set(idList(exceptComponentIds));
  const parts = await ClientDevice.find({
    parentDeviceId: host._id,
    deletedAt: null,
  });
  if (!componentIds) {
    return {
      components: parts.filter((part) => !except.has(String(part._id))),
    };
  }
  const byId = new Map(parts.map((part) => [String(part._id), part]));
  const components = [];
  for (const id of idList(componentIds)) {
    const part = byId.get(id);
    if (!part) {
      const gone = mongoose.isValidObjectId(id)
        ? await ClientDevice.findById(id)
        : null;
      const name = gone?.inventoryNumber || gone?.serialNumber || "без номера";
      return {
        error: fail(409, `Деталь «${name}» уже не в составе устройства`),
      };
    }
    if (!except.has(id)) components.push(part);
  }
  return { components };
};

// Ошибка приведения/валидации Mongoose -> 400 с названием поля.
const validationFailure = (error) => {
  if (error?.name === "CastError") {
    return fail(400, `Неверное значение поля «${error.path}»`);
  }
  if (error?.name === "ValidationError") {
    const field = Object.keys(error.errors || {})[0];
    return fail(400, `Неверное значение поля «${field}»`);
  }
  return null;
};

// Исполнитель плана: check — без записей, но с той же проверкой типов, что
// сделает save (validate по изменённым полям); иначе save по порядку (хост,
// затем детали). E11000 -> 409, ошибка значения -> 400, остальное -> 500.
// snapshot: в affected отдаём { _id, updatedAt } — снимок для сверки дрейфа.
const execute = async (failMessage, check, plan, { snapshot = false } = {}) => {
  try {
    const planned = await plan();
    if (!planned.ok) return planned;
    if (check) {
      for (const doc of planned.writes) {
        await doc.validate(doc.modifiedPaths());
      }
    } else {
      for (const doc of planned.writes) await doc.save();
    }
    return {
      ok: true,
      device: planned.device,
      affected: planned.affected.map((doc) =>
        snapshot && check
          ? { _id: doc._id, updatedAt: doc.updatedAt }
          : doc._id,
      ),
      // Прежние значения изменённых полей (правка, статус) — только проверке:
      // предложение агента показывает «было → стало»
      ...(check && planned.before ? { before: planned.before } : {}),
    };
  } catch (error) {
    const duplicate = duplicateError(error);
    if (duplicate) return { ok: false, ...duplicate };
    const invalid = validationFailure(error);
    if (invalid) return invalid;
    return { ok: false, status: 500, message: failMessage, error };
  }
};

// Привязка/снятие пользователя. Назначение переводит статус в "deployed"
// (Выдано); снятие возвращает "readyForDeployment", если было "deployed".
// Общий update не годится: buildDevicePayload затирает незаданные поля.
const planAssignUser = async (
  deviceId,
  rawUserId,
  {
    actorId,
    withComponents = false,
    exceptComponentIds = [],
    componentIds,
  } = {},
) => {
  const device = await ClientDevice.findById(deviceId);
  if (!device) return fail(404, `Device with id ${deviceId} not found`);

  const userId = clean(rawUserId || undefined);

  if (userId) {
    const user = await User.findById(userId);
    const userCompanyId = user?.company?._id || user?.company;
    if (!user || userCompanyId?.toString() !== device.companyId?.toString()) {
      return fail(400, "Assigned user must belong to the same company");
    }
    device.userId = userId;
    device.status = "deployed";
  } else {
    device.userId = undefined;
    if (device.status === "deployed") device.status = "readyForDeployment";
  }
  device.updatedBy = actorId;

  const cascade = withComponents
    ? await liveComponents(device, exceptComponentIds, componentIds)
    : { components: [] };
  if (cascade.error) return cascade.error;
  const { components } = cascade;
  for (const part of components) {
    // Статус по правилу для каждой детали: у деталей в ремонте и т.п. он свой.
    part.userId = device.userId;
    if (device.userId) part.status = "deployed";
    else if (part.status === "deployed") part.status = "readyForDeployment";
    part.updatedBy = actorId;
  }
  return {
    ok: true,
    device,
    writes: [device, ...components],
    affected: components,
  };
};

// Прикрепить существующее устройство к сборке. Компонент «следует за хостом»:
// перенимает компанию/расположение/пользователя/статус. Тип должен быть
// прикрепляемым и совместимым с хостом; нельзя прикрепить сборку или само себя.
const planAttachComponent = async (hostId, rawComponentId, { actorId } = {}) => {
  const componentId = clean(rawComponentId);

  if (!componentId) return fail(400, "Не указан компонент");
  if (String(componentId) === String(hostId)) {
    return fail(400, "Нельзя прикрепить устройство к самому себе");
  }

  const host = await ClientDevice.findById(hostId);
  if (!host || host.deletedAt) {
    return fail(404, `Device with id ${hostId} not found`);
  }

  const component = await ClientDevice.findById(componentId);
  if (!component || component.deletedAt) {
    return fail(404, `Component ${componentId} not found`);
  }

  if (
    component.parentDeviceId &&
    String(component.parentDeviceId) !== String(host._id)
  ) {
    return fail(409, "Устройство уже входит в другую сборку");
  }

  const hasChildren = await ClientDevice.exists({
    parentDeviceId: component._id,
    deletedAt: null,
  });
  if (hasChildren) {
    return fail(
      409,
      "Нельзя прикрепить устройство, которое само является сборкой",
    );
  }

  const rule = await attachTypeError(
    await getEffectiveTypeId(component),
    host,
  );
  if (rule) return rule;

  // Компания у детали меняется на хостовую: имя в сети не должно столкнуться
  // там (иначе проверка пройдёт, а запись упадёт на уникальном индексе).
  const taken = await findTakenIdentity({
    hostname: component.hostname,
    companyId: host.companyId,
    excludeId: component._id,
  });
  if (taken) return fail(taken.status, taken.message);

  // Следует за хостом.
  component.parentDeviceId = host._id;
  component.companyId = host.companyId;
  component.locationId = host.locationId;
  component.userId = host.userId;
  component.status = host.status;
  component.updatedBy = actorId;
  return {
    ok: true,
    device: component,
    writes: [component],
    affected: [component],
  };
};

// Открепить комплектующее: разрывает связь с хостом и возвращает устройство в
// общий список как «Готово к выдаче» (без пользователя). Расположение сохраняем.
const planDetachComponent = async (hostId, componentId, { actorId } = {}) => {
  const component = await ClientDevice.findById(componentId);
  if (!component || component.deletedAt) {
    return fail(404, `Component ${componentId} not found`);
  }
  if (String(component.parentDeviceId || "") !== String(hostId)) {
    return fail(400, "Устройство не входит в эту сборку");
  }

  component.parentDeviceId = undefined;
  component.userId = undefined;
  component.status = "readyForDeployment";
  component.updatedBy = actorId;
  return {
    ok: true,
    device: component,
    writes: [component],
    affected: [component],
  };
};

// Перенос в помещение (null — снять помещение). Правило агента: помещение
// существует и либо той же компании, что устройство, либо общее (isPublic).
const planMoveDevice = async (
  deviceId,
  rawLocationId,
  {
    actorId,
    withComponents = true,
    exceptComponentIds = [],
    componentIds,
  } = {},
) => {
  const device = await ClientDevice.findById(deviceId);
  if (!device || device.deletedAt) {
    return fail(404, `Device with id ${deviceId} not found`);
  }

  const locationId = clean(rawLocationId || undefined);
  if (locationId) {
    const wrong = await locationError(locationId, device.companyId);
    if (wrong) return wrong;
  }

  device.locationId = locationId;
  device.updatedBy = actorId;

  const cascade = withComponents
    ? await liveComponents(device, exceptComponentIds, componentIds)
    : { components: [] };
  if (cascade.error) return cascade.error;
  const { components } = cascade;
  for (const part of components) {
    part.locationId = locationId;
    part.updatedBy = actorId;
  }
  return {
    ok: true,
    device,
    writes: [device, ...components],
    affected: components,
  };
};

// Смена статуса. Любой статус, кроме "deployed", снимает пользователя —
// как правило формы.
const planSetDeviceStatus = async (
  deviceId,
  status,
  {
    actorId,
    withComponents = true,
    exceptComponentIds = [],
    componentIds,
  } = {},
) => {
  const allowed = ClientDevice.schema.path("status").enumValues;
  if (!allowed.includes(status)) {
    return fail(400, `Неизвестный статус «${status}»`);
  }
  const device = await ClientDevice.findById(deviceId);
  if (!device || device.deletedAt) {
    return fail(404, `Device with id ${deviceId} not found`);
  }

  const before = { status: device.status };
  device.status = status;
  if (status !== "deployed") device.userId = undefined;
  device.updatedBy = actorId;

  const cascade = withComponents
    ? await liveComponents(device, exceptComponentIds, componentIds)
    : { components: [] };
  if (cascade.error) return cascade.error;
  const { components } = cascade;
  for (const part of components) {
    part.status = status;
    if (status !== "deployed") part.userId = undefined;
    part.updatedBy = actorId;
  }
  return {
    ok: true,
    device,
    writes: [device, ...components],
    affected: components,
    before,
  };
};

// Поля, которые агент вправе менять правкой. Компания, пользователь,
// расположение, статус, модель, тип и связи со сборкой — отдельными
// операциями или не меняются вовсе.
const PATCH_FIELDS = [
  "serialNumber",
  "inventoryNumber",
  "hostname",
  "ipAddress",
  "operatingSystem",
  "purchasedAt",
  "price",
  "supplierId",
  "purchaseDocument",
  "warrantyExpirationDate",
  "deploymentDate",
  "nextMaintenanceDate",
  "comment",
  "configurationId",
];
// Из них ОС и IP пишутся в системные атрибуты (systemDeviceAttributes)
const SYSTEM_FIELDS = Object.values(FIELD_BY_KEY);
const PATCH_DATE_FIELDS = [
  "purchasedAt",
  "warrantyExpirationDate",
  "deploymentDate",
  "nextMaintenanceDate",
];
const PATCH_ID_FIELDS = ["supplierId", "configurationId"];
const PATCH_STRING_FIELDS = [
  "serialNumber",
  "inventoryNumber",
  "hostname",
  "ipAddress",
  "operatingSystem",
  "purchaseDocument",
  "comment",
];

const planPatchDevice = async (deviceId, patch, { actorId } = {}) => {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return fail(400, "Нет полей для изменения");
  }
  const unknown = Object.keys(patch).find((key) => !PATCH_FIELDS.includes(key));
  if (unknown) return fail(400, `Поле «${unknown}» нельзя менять через агента`);
  if (Object.keys(patch).length === 0) {
    return fail(400, "Нет полей для изменения");
  }

  const device = await ClientDevice.findById(deviceId);
  if (!device || device.deletedAt) {
    return fail(404, `Device with id ${deviceId} not found`);
  }

  // null и "" снимают значение, как пустое поле формы.
  const values = {};
  for (const key of PATCH_FIELDS) {
    if (!(key in patch)) continue;
    const value = patch[key] === null ? undefined : clean(patch[key]);
    if (value !== undefined) {
      // Объект/массив/булево до запросов и Mongoose не доходят.
      const type = typeof value;
      if (
        ((PATCH_STRING_FIELDS.includes(key) ||
          PATCH_ID_FIELDS.includes(key) ||
          PATCH_DATE_FIELDS.includes(key)) &&
          type !== "string") ||
        (key === "price" && type !== "number" && type !== "string")
      ) {
        return fail(400, `Неверное значение поля «${key}»`);
      }
      if (PATCH_DATE_FIELDS.includes(key) && !isValidDate(value)) {
        return fail(400, `Некорректная дата в поле «${key}»`);
      }
      if (PATCH_ID_FIELDS.includes(key) && !mongoose.isValidObjectId(value)) {
        return fail(400, `Некорректный идентификатор в поле «${key}»`);
      }
      if (key === "price" && !(Number(value) >= 0)) {
        return fail(400, "Цена должна быть неотрицательным числом");
      }
    }
    values[key] = value;
  }

  if ("inventoryNumber" in values && !values.inventoryNumber) {
    return fail(400, "Инвентарный номер нельзя очистить");
  }
  // Те же цепочки, что у формы, — только по переданным полям
  const invalid = await fieldErrors(patch, Object.keys(patch));
  if (invalid) return invalid;
  // Проверяем только изменившееся; имя в сети — в компании устройства.
  const taken = await findTakenIdentity({
    inventoryNumber:
      values.inventoryNumber !== device.inventoryNumber
        ? values.inventoryNumber
        : undefined,
    hostname:
      values.hostname !== device.hostname ? values.hostname : undefined,
    companyId: device.companyId,
    excludeId: device._id,
  });
  if (taken) return fail(taken.status, taken.message);

  // Конфигурация — пресет модели этого устройства.
  if (values.configurationId) {
    const wrong = await configurationError(
      values.configurationId,
      device.deviceModelId,
    );
    if (wrong) return wrong;
  }

  // ОС и IP — системные атрибуты устройства, не поля документа
  const systemPatch = {};
  for (const field of SYSTEM_FIELDS) {
    if (!(field in values)) continue;
    systemPatch[field] = values[field] ?? "";
    delete values[field];
  }
  const ids = Object.keys(systemPatch).length ? await systemIds() : null;
  const current = ids ? systemValues(device, ids) : {};

  // Прежние значения — до записи в документ (сырые: ObjectId, Date, число)
  const before = Object.fromEntries([
    ...Object.keys(values).map((key) => [key, device[key]]),
    ...Object.keys(systemPatch).map((key) => [key, current[key] ?? undefined]),
  ]);
  Object.assign(device, values, { updatedBy: actorId });
  const system = await planSystemValues(device, systemPatch, {
    typeId: ids ? await getEffectiveTypeId(device) : null,
    ids,
  });
  const links = (system?.links ?? []).map((link) => new DeviceTypeAttribute(link));
  if (system) device.attributes = system.attributes;
  return {
    ok: true,
    device,
    writes: [device, ...links],
    affected: [device],
    before,
  };
};

// snapshot: check-близнец отдаёт в affected { _id, updatedAt } (каскад).
const operation = (failMessage, plan, opts) => ({
  check: (...args) =>
    execute(failMessage(...args), true, () => plan(...args), opts),
  run: (...args) =>
    execute(failMessage(...args), false, () => plan(...args), opts),
});

const assign = operation(
  (id) => `Failed to assign user to device ${id}`,
  planAssignUser,
  { snapshot: true },
);
const attach = operation(() => "Failed to attach component", planAttachComponent);
const detach = operation(() => "Failed to detach component", planDetachComponent);
const move = operation((id) => `Failed to move device ${id}`, planMoveDevice, {
  snapshot: true,
});
const status = operation(
  (id) => `Failed to change status of device ${id}`,
  planSetDeviceStatus,
  { snapshot: true },
);
const patch = operation(
  (id) => `Failed to update device ${id}`,
  planPatchDevice,
);

module.exports = {
  checkNewDevice,
  createDevice,
  checkAgentDevice,
  createAgentDevice,
  assignUser: assign.run,
  checkAssignUser: assign.check,
  attachComponent: attach.run,
  checkAttachComponent: attach.check,
  detachComponent: detach.run,
  checkDetachComponent: detach.check,
  moveDevice: move.run,
  checkMoveDevice: move.check,
  setDeviceStatus: status.run,
  checkSetDeviceStatus: status.check,
  patchDevice: patch.run,
  checkPatchDevice: patch.check,
  getEffectiveTypeId,
  generateInventoryNumber,
  duplicateError,
  findTakenIdentity,
  buildDevicePayload,
  // Общие с контроллером: правка устройства и список деталей
  clean,
  planDeviceParts,
  validateAssembly,
};
