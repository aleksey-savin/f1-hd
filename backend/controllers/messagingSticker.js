const Sticker = require("../models/messagingSticker");
const storage = require("../services/storage");
const { AppError } = require("../middleware/errorHandling");
const { validateSticker, catalogueFilter } = require("../services/messaging/stickers");
const row = (sticker) => ({
  id: String(sticker._id),
  label: sticker.label,
  name: sticker.name,
});
exports.list = async (req, res, next) => {
  try {
    const pack = await require("../models/messagingStickerPack")
      .findById("corporate")
      .lean();
    const stickers = await Sticker.find(
      catalogueFilter(pack),
    )
      .sort({ createdAt: 1 })
      .lean();
    if (pack)
      stickers.sort(
        (a, b) =>
          pack.keys.indexOf(a.sourceKey) - pack.keys.indexOf(b.sourceKey),
      );
    res.json({
      stickers: stickers.map(row),
      pack: pack
        ? {
            name: pack.name,
            title: pack.title,
            url: `https://t.me/addstickers/${pack.name}`,
          }
        : null,
    });
  } catch (error) {
    next(error);
  }
};
exports.upload = async (req, res, next) => {
  try {
    if (
      await require("../models/messagingStickerPack").exists({
        _id: "corporate",
      })
    )
      throw new AppError(
        "Изменяйте корпоративный набор по ссылке Telegram",
        409,
      );
    if (!req.file) throw new AppError("Выберите файл WebP", 400);
    validateSticker(req.file.buffer);
    const label =
      String(req.file.originalname)
        .replace(/\.webp$/i, "")
        .slice(0, 100) || "Стикер";
    const object = await storage.putObject(req.file.buffer, {
      originalName: "sticker.webp",
      mimetype: "image/webp",
      prefix: "sticker",
    });
    let sticker;
    try {
      sticker = await Sticker.create({ ...object, label });
    } catch (error) {
      await storage.deleteObject(object.name).catch(() => {});
      throw error;
    }
    res.status(201).json({ sticker: row(sticker) });
  } catch (error) {
    next(error);
  }
};
// Keep bytes for historical messages and pending jobs, even after removing from the pack.
exports.remove = async (req, res, next) => {
  try {
    if (
      await require("../models/messagingStickerPack").exists({
        _id: "corporate",
      })
    )
      throw new AppError(
        "Изменяйте корпоративный набор по ссылке Telegram",
        409,
      );
    if (!/^[a-f\d]{24}$/i.test(req.params.id))
      throw new AppError("Стикер не найден", 404);
    await Sticker.updateOne(
      { _id: req.params.id },
      { $set: { active: false } },
    );
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
};

exports.importSet = async (req, res, next) => {
  try {
    res.json(
      await require("../services/messaging/sticker-import").importStickerSet(
        req.body?.url,
      ),
    );
  } catch (error) {
    next(error);
  }
};
