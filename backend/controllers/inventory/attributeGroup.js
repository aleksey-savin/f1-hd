const mongoose = require("mongoose");

const AttributeGroup = require("@/models/inventory/attributeGroup");
const DeviceTypeAttribute = require("@/models/inventory/deviceTypeAttribute");
const { AppError } = require("@/middleware/errorHandling");

const MAX_NAME = 80;
const COLLATION = { locale: "ru", strength: 2 };

// Связки типов лежат в devicetypeattributes; groupId появится в схеме позже,
// поэтому читаем нативную коллекцию — строгая схема не должна выбросить фильтр.
const links = () => DeviceTypeAttribute.collection;

// Имя группы: обрезка, схлопывание пробелов, непустое, не длиннее MAX_NAME.
exports.parseGroupName = (raw) => {
  const name = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (!name) return { error: "Укажите название группы" };
  if (name.length > MAX_NAME) {
    return { error: `Название не длиннее ${MAX_NAME} символов` };
  }
  return { name };
};

const nameTaken = (name, exceptId) =>
  AttributeGroup.exists({
    name,
    ...(exceptId ? { _id: { $ne: exceptId } } : {}),
  }).collation(COLLATION);

// GET /attribute-groups — группы с числом типов и атрибутов, использующих их.
exports.getAll = async (req, res, next) => {
  try {
    const groups = await AttributeGroup.find()
      .sort({ order: 1, name: 1 })
      .collation(COLLATION)
      .lean();

    const usage = await links()
      .aggregate([
        { $match: { groupId: { $in: groups.map((g) => g._id) } } },
        {
          $group: {
            _id: "$groupId",
            types: { $addToSet: "$deviceTypeId" },
            attributesCount: { $sum: 1 },
          },
        },
      ])
      .toArray();
    const byGroup = new Map(usage.map((u) => [String(u._id), u]));

    res.status(200).json(
      groups.map((g) => {
        const u = byGroup.get(String(g._id));
        return {
          _id: g._id,
          name: g.name,
          order: g.order,
          typesCount: u ? u.types.length : 0,
          attributesCount: u ? u.attributesCount : 0,
        };
      }),
    );
  } catch (error) {
    next(new AppError("Failed to fetch attribute groups", 500, true, error));
  }
};

// POST /attribute-groups/add — новая группа в конец списка.
exports.add = async (req, res, next) => {
  try {
    const parsed = exports.parseGroupName(req.body.name);
    if (parsed.error) return next(new AppError(parsed.error, 400));

    if (await nameTaken(parsed.name)) {
      return next(new AppError(`Группа «${parsed.name}» уже есть`, 409));
    }

    const last = await AttributeGroup.findOne()
      .sort({ order: -1 })
      .select("order")
      .lean();

    const attributeGroup = await AttributeGroup.create({
      name: parsed.name,
      order: last ? (last.order || 0) + 1 : 0,
      createdBy: req.userId,
    });

    res.status(201).json({ message: "Группа создана", attributeGroup });
  } catch (error) {
    // Гонка двух запросов: сработал уникальный индекс
    if (error?.code === 11000) {
      return next(new AppError("Такая группа уже есть", 409));
    }
    next(new AppError("Failed to create attribute group", 500, true, error));
  }
};

// PUT /attribute-groups/update/:id — переименовать.
exports.update = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return next(new AppError("Неверный идентификатор группы", 400));
    }
    const parsed = exports.parseGroupName(req.body.name);
    if (parsed.error) return next(new AppError(parsed.error, 400));

    const group = await AttributeGroup.findById(req.params.id);
    if (!group) {
      return next(
        new AppError(`Attribute group with id ${req.params.id} not found`, 404),
      );
    }

    if (await nameTaken(parsed.name, group._id)) {
      return next(new AppError(`Группа «${parsed.name}» уже есть`, 409));
    }

    group.name = parsed.name;
    group.updatedBy = req.userId;
    await group.save();

    res
      .status(200)
      .json({ message: "Группа переименована", attributeGroup: group });
  } catch (error) {
    if (error?.code === 11000) {
      return next(new AppError("Такая группа уже есть", 409));
    }
    next(
      new AppError(
        `Failed to update attribute group ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

// PUT /attribute-groups/reorder — body: { orderedIds }; order = позиция.
exports.reorder = async (req, res, next) => {
  try {
    const { orderedIds } = req.body;
    if (
      !Array.isArray(orderedIds) ||
      !orderedIds.every((id) => mongoose.isValidObjectId(id))
    ) {
      return next(new AppError("orderedIds обязателен", 400));
    }

    await Promise.all(
      orderedIds.map((id, index) =>
        AttributeGroup.updateOne(
          { _id: id },
          { $set: { order: index, updatedBy: req.userId } },
        ),
      ),
    );

    const groups = await AttributeGroup.find()
      .sort({ order: 1, name: 1 })
      .collation(COLLATION);

    res
      .status(200)
      .json({ message: "Порядок обновлён", attributeGroups: groups });
  } catch (error) {
    next(new AppError("Failed to reorder attribute groups", 500, true, error));
  }
};

// POST /attribute-groups/delete/:id — жёсткое удаление; группа, на которую
// ссылается связка атрибута типа, не удаляется.
exports.delete = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return next(new AppError("Неверный идентификатор группы", 400));
    }
    const group = await AttributeGroup.findById(req.params.id);
    if (!group) {
      return next(
        new AppError(`Attribute group with id ${req.params.id} not found`, 404),
      );
    }

    const used = await links().countDocuments({ groupId: group._id });
    if (used > 0) {
      return next(new AppError("Группа используется", 409));
    }

    await AttributeGroup.deleteOne({ _id: group._id });
    res.status(204).end();
  } catch (error) {
    next(
      new AppError(
        `Failed to delete attribute group ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};
