const mongoose = require("mongoose");

const DeviceTypeAttribute = require("@/models/inventory/deviceTypeAttribute");
const DeviceType = require("@/models/inventory/deviceType");
const DeviceAttribute = require("@/models/inventory/deviceAttribute");
const AttributeGroup = require("@/models/inventory/attributeGroup");
const { AppError } = require("@/middleware/errorHandling");
const { uniqueAttributeCode } = require("@/services/attributeCode");

// Поля каталожного атрибута, нужные карточке и форме конфигурации.
const ATTRIBUTE_FIELDS = "code name valueType unit options isActive";

const VALUE_TYPES = DeviceAttribute.schema.path("valueType").enumValues;
const SELECT_TYPES = ["select", "multiselect"];
const MAX_ITEMS = 100;

// Группа на связке всегда приходит populated: имя и порядок нужны, чтобы
// сгруппировать список без второго запроса.
const GROUP_FIELDS = "name order";

// Разбор groupId из тела: undefined — не менять, null/"" — снять группу,
// ObjectId (строкой) — назначить; всё остальное — ошибка.
exports.parseGroupId = (raw) => {
  if (raw === undefined) return { groupId: undefined };
  if (raw === null || raw === "") return { groupId: null };
  const id = typeof raw === "string" ? raw : String(raw?._id ?? "");
  if (!/^[0-9a-fA-F]{24}$/.test(id)) {
    return { error: "Неверный идентификатор группы" };
  }
  return { groupId: id };
};

// GET /device-type-attributes/type/:id — связки атрибутов типа (для ревалидации
// карточки). Тот же populate+sort, что и в deviceType.getOne.
exports.getByDeviceTypeId = async (req, res, next) => {
  try {
    const attributes = await DeviceTypeAttribute.find({
      deviceTypeId: req.params.id,
    })
      .populate("attributeId", ATTRIBUTE_FIELDS)
      .populate("groupId", GROUP_FIELDS)
      .sort({ order: 1, createdAt: 1 });

    res.status(200).json(attributes);
  } catch (error) {
    next(
      new AppError("Failed to fetch device type attributes", 500, true, error),
    );
  }
};

// GET /device-type-attributes/:id — одна связка (для формы правки).
exports.getOne = async (req, res, next) => {
  try {
    const attribute = await DeviceTypeAttribute.findById(req.params.id)
      .populate("attributeId", ATTRIBUTE_FIELDS)
      .populate("groupId", GROUP_FIELDS)
      .populate("deviceTypeId", "name");

    if (!attribute) {
      return next(
        new AppError(
          `Device type attribute with id ${req.params.id} not found`,
          404,
        ),
      );
    }
    res.status(200).json(attribute);
  } catch (error) {
    next(
      new AppError(
        `Failed to fetch device type attribute ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

// Разбор пачки «Добавить атрибуты»: элемент — либо готовый атрибут каталога
// `{ attributeId }`, либо новый `{ attribute: { name, valueType, unit,
// options, isActive } }`. Порядок сохраняется (в нём атрибуты встанут в тип);
// битые элементы и дубли внутри пачки отсекаются до любой записи в базу.
exports.parseAddItems = (items) => {
  if (!Array.isArray(items) || items.length === 0) {
    return { error: "Отметьте хотя бы один атрибут" };
  }
  if (items.length > MAX_ITEMS) {
    return { error: `За раз можно добавить не больше ${MAX_ITEMS} атрибутов` };
  }

  const seenIds = new Set();
  const seenNames = new Set();
  const entries = [];
  for (const item of items) {
    if (item?.attributeId) {
      const id = String(item.attributeId);
      if (!mongoose.isValidObjectId(id)) {
        return { error: "Неверный идентификатор атрибута" };
      }
      if (!seenIds.has(id)) {
        seenIds.add(id);
        entries.push({ attributeId: id });
      }
      continue;
    }

    const attr = item?.attribute;
    const name = typeof attr?.name === "string" ? attr.name.trim() : "";
    if (!name) return { error: "У нового атрибута нет наименования" };
    const key = name.toLocaleLowerCase("ru");
    if (seenNames.has(key)) {
      return { error: `Атрибут «${name}» создаётся дважды` };
    }
    seenNames.add(key);

    if (!VALUE_TYPES.includes(attr.valueType)) {
      return { error: `У атрибута «${name}» неверный тип данных` };
    }
    const withOptions = SELECT_TYPES.includes(attr.valueType);
    const options = withOptions ? normalizeOptions(attr.options) : [];
    if (withOptions && options.length === 0) {
      return { error: `У атрибута «${name}» нет вариантов выбора` };
    }

    entries.push({
      attribute: {
        name,
        valueType: attr.valueType,
        unit: typeof attr.unit === "string" ? attr.unit.trim() : "",
        options,
        isActive: attr.isActive !== false,
      },
    });
  }
  return { entries };
};

// Варианты выбора: строки или `{ value, label }`; пустые и повторы убираем.
const normalizeOptions = (options) => {
  if (!Array.isArray(options)) return [];
  const seen = new Set();
  const result = [];
  for (const option of options) {
    const value = String(
      typeof option === "object" && option ? (option.value ?? "") : (option ?? ""),
    ).trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    const label =
      typeof option === "object" && option?.label
        ? String(option.label).trim()
        : value;
    result.push({ value, label: label || value });
  }
  return result;
};

// POST /device-type-attributes/add — добавить к типу пачку атрибутов (в конец
// списка, в порядке пачки); новые сперва создаются в каталоге. Все проверки —
// до первой записи; транзакций нет (одиночный mongod), поэтому сбой посреди
// записи откатывается удалением созданного по списку _id.
exports.add = async (req, res, next) => {
  try {
    const { deviceTypeId } = req.body;
    if (!deviceTypeId || !mongoose.isValidObjectId(deviceTypeId)) {
      return next(new AppError("deviceTypeId обязателен", 400));
    }

    const parsed = exports.parseAddItems(req.body.items);
    if (parsed.error) return next(new AppError(parsed.error, 400));
    const { entries } = parsed;

    const group = exports.parseGroupId(req.body.groupId);
    if (group.error) return next(new AppError(group.error, 400));

    if (!(await DeviceType.exists({ _id: deviceTypeId }))) {
      return next(
        new AppError(`Device type with id ${deviceTypeId} not found`, 404),
      );
    }

    if (
      group.groupId &&
      !(await AttributeGroup.exists({ _id: group.groupId }))
    ) {
      return next(
        new AppError(`Группа с id ${group.groupId} не найдена`, 404),
      );
    }

    const ids = entries.filter((e) => e.attributeId).map((e) => e.attributeId);
    if (ids.length) {
      const found = await DeviceAttribute.countDocuments({ _id: { $in: ids } });
      if (found !== ids.length) {
        return next(
          new AppError(
            "Часть атрибутов не найдена в каталоге. Обновите страницу.",
            404,
          ),
        );
      }
      // Один атрибут — одна связка с типом
      const linked = await DeviceTypeAttribute.find({
        deviceTypeId,
        attributeId: { $in: ids },
      })
        .populate("attributeId", "name")
        .lean();
      if (linked.length) {
        const names = linked.map((l) => `«${l.attributeId?.name}»`).join(", ");
        return next(new AppError(`Уже добавлены к типу: ${names}`, 409));
      }
    }

    // Наименование уникально без учёта регистра (и по устаревшему индексу
    // name_1 на старых базах) — готовый атрибут отмечают, а не создают заново
    const freshNames = entries
      .filter((e) => e.attribute)
      .map((e) => e.attribute.name);
    if (freshNames.length) {
      const taken = await DeviceAttribute.find({ name: { $in: freshNames } })
        .collation({ locale: "ru", strength: 2 })
        .select("name")
        .lean();
      if (taken.length) {
        const names = taken.map((a) => `«${a.name}»`).join(", ");
        return next(
          new AppError(
            `Уже есть в каталоге: ${names}. Отметьте в списке.`,
            409,
          ),
        );
      }
    }

    // Порядок — следом за последним
    const last = await DeviceTypeAttribute.findOne({ deviceTypeId })
      .sort({ order: -1 })
      .select("order")
      .lean();
    let order = last ? (last.order || 0) + 1 : 0;

    const createdAttributeIds = [];
    const createdLinkIds = [];
    try {
      for (const entry of entries) {
        let attributeId = entry.attributeId;
        if (!attributeId) {
          const code = await uniqueAttributeCode(
            DeviceAttribute,
            entry.attribute.name,
          );
          const attribute = await DeviceAttribute.create({
            ...entry.attribute,
            code,
            createdBy: req.userId,
          });
          createdAttributeIds.push(attribute._id);
          attributeId = attribute._id;
        }
        const link = await DeviceTypeAttribute.create({
          deviceTypeId,
          attributeId,
          groupId: group.groupId ?? null,
          order: order++,
          createdBy: req.userId,
        });
        createdLinkIds.push(link._id);
      }
    } catch (error) {
      await DeviceTypeAttribute.deleteMany({ _id: { $in: createdLinkIds } });
      await DeviceAttribute.deleteMany({ _id: { $in: createdAttributeIds } });
      throw error;
    }

    const created = await DeviceTypeAttribute.find({
      _id: { $in: createdLinkIds },
    })
      .populate("attributeId", ATTRIBUTE_FIELDS)
      .populate("groupId", GROUP_FIELDS)
      .sort({ order: 1 });

    res.status(201).json({
      message: "Атрибуты добавлены к типу",
      deviceTypeAttributes: created,
    });
  } catch (error) {
    next(new AppError("Failed to add device type attributes", 500, true, error));
  }
};

// PUT /device-type-attributes/update/:id — сменить атрибут/флаги связки.
exports.update = async (req, res, next) => {
  try {
    const { attributeId, required, extendable } = req.body;

    const link = await DeviceTypeAttribute.findById(req.params.id);
    if (!link) {
      return next(
        new AppError(
          `Device type attribute with id ${req.params.id} not found`,
          404,
        ),
      );
    }

    if (attributeId && String(attributeId) !== String(link.attributeId)) {
      const attribute = await DeviceAttribute.findById(attributeId);
      if (!attribute) {
        return next(
          new AppError(
            `Device attribute with id ${attributeId} not found`,
            404,
          ),
        );
      }
      const duplicate = await DeviceTypeAttribute.findOne({
        deviceTypeId: link.deviceTypeId,
        attributeId,
        _id: { $ne: link._id },
      });
      if (duplicate) {
        return next(
          new AppError(`Атрибут «${attribute.name}» уже добавлен к типу`, 409),
        );
      }
      link.attributeId = attributeId;
    }

    const group = exports.parseGroupId(req.body.groupId);
    if (group.error) return next(new AppError(group.error, 400));
    if (
      group.groupId &&
      !(await AttributeGroup.exists({ _id: group.groupId }))
    ) {
      return next(
        new AppError(`Группа с id ${group.groupId} не найдена`, 404),
      );
    }
    if (group.groupId !== undefined) link.groupId = group.groupId;

    if (required !== undefined) link.required = !!required;
    if (extendable !== undefined) link.extendable = !!extendable;
    link.updatedBy = req.userId;

    await link.save();

    const populated = await DeviceTypeAttribute.findById(link._id)
      .populate("attributeId", ATTRIBUTE_FIELDS)
      .populate("groupId", GROUP_FIELDS);

    res.status(200).json({
      message: "Атрибут типа обновлён",
      deviceTypeAttribute: populated,
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to update device type attribute ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

// POST /device-type-attributes/delete/:id — жёсткое удаление (модель без
// soft-delete; так же, как bulk-удаление связок в deviceType-контроллере).
exports.delete = async (req, res, next) => {
  try {
    const link = await DeviceTypeAttribute.findById(req.params.id);
    if (!link) {
      return next(
        new AppError(
          `Device type attribute with id ${req.params.id} not found`,
          404,
        ),
      );
    }

    await DeviceTypeAttribute.deleteOne({ _id: req.params.id });
    res.status(204).end();
  } catch (error) {
    next(
      new AppError(
        `Failed to delete device type attribute ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

// PUT /device-type-attributes/reorder — body: { deviceTypeId, orderedIds }.
// order = позиция в массиве; апдейтим только связки этого типа.
exports.reorder = async (req, res, next) => {
  try {
    const { deviceTypeId, orderedIds } = req.body;

    if (!deviceTypeId || !Array.isArray(orderedIds)) {
      return next(new AppError("deviceTypeId и orderedIds обязательны", 400));
    }

    await Promise.all(
      orderedIds.map((id, index) =>
        DeviceTypeAttribute.updateOne(
          { _id: id, deviceTypeId },
          { $set: { order: index, updatedBy: req.userId } },
        ),
      ),
    );

    const attributes = await DeviceTypeAttribute.find({ deviceTypeId })
      .populate("attributeId", ATTRIBUTE_FIELDS)
      .populate("groupId", GROUP_FIELDS)
      .sort({ order: 1, createdAt: 1 });

    res.status(200).json({ message: "Порядок обновлён", attributes });
  } catch (error) {
    next(
      new AppError(
        "Failed to reorder device type attributes",
        500,
        true,
        error,
      ),
    );
  }
};
