const { AppError } = require("../../middleware/errorHandling");
const { validateSticker } = require("./stickers");
const fail = (message) => new AppError(message, 400);
const parseSetName = (value) => {
  if (typeof value !== "string") throw fail("Укажите ссылку на набор Telegram");
  const match = value
    .trim()
    .match(
      /^(?:https:\/\/t\.me\/addstickers\/)?([A-Za-z][A-Za-z0-9_]{0,63})\/?$/,
    );
  if (!match)
    throw fail("Нужна ссылка вида https://t.me/addstickers/НазваниеНабора");
  return match[1];
};
// Never let token-bearing request URLs or upstream errors reach logs/clients.
const telegramClient = (token, request = fetch) => {
  if (!token)
    throw fail("Для импорта нужен настроенный Telegram-бот (TG_TOKEN)");
  const call = async (method, body) => {
    try {
      const response = await request(
        `https://api.telegram.org/bot${token}/${method}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          redirect: "error",
          signal: AbortSignal.timeout(20000),
        },
      );
      const data = await response.json();
      if (!response.ok || !data.ok) throw Error();
      return data.result;
    } catch {
      throw new AppError(
        "Telegram не вернул набор или файл. Проверьте ссылку и подключение бота.",
        502,
      );
    }
  };
  return {
    getSet: (name) => call("getStickerSet", { name }),
    download: async (sticker) => {
      const file = await call("getFile", { file_id: sticker.file_id });
      if (
        typeof file.file_path !== "string" ||
        !/^stickers\/[A-Za-z0-9_.-]+$/.test(file.file_path)
      )
        throw fail("Telegram вернул неподдерживаемый путь стикера");
      try {
        const response = await request(
          `https://api.telegram.org/file/bot${token}/${file.file_path}`,
          { redirect: "error", signal: AbortSignal.timeout(20000) },
        );
        if (!response.ok || !response.body) throw Error();
        const chunks = [];
        let size = 0;
        for await (const chunk of response.body) {
          size += chunk.length;
          if (size > 512 * 1024) throw Error();
          chunks.push(Buffer.from(chunk));
        }
        return Buffer.concat(chunks);
      } catch {
        throw new AppError(
          "Не удалось скачать статичный стикер до 512 КБ из Telegram",
          502,
        );
      }
    },
  };
};
const createImporter =
  ({
    getSet,
    download,
    find,
    put,
    save,
    remove,
    publish = async () => {},
    validate = validateSticker,
  }) =>
  async (input) => {
    const name = parseSetName(input),
      set = await getSet(name);
    if (
      !set ||
      !Array.isArray(set.stickers) ||
      !set.stickers.length ||
      set.stickers.length > 120
    )
      throw fail("Набор должен содержать от 1 до 120 стикеров");
    if (
      set.stickers.some(
        (s) =>
          !s ||
          s.is_animated ||
          s.is_video ||
          s.type !== "regular" ||
          typeof s.file_id !== "string" ||
          typeof s.file_unique_id !== "string" ||
          !/^[\w-]{1,128}$/.test(s.file_unique_id),
      )
    )
      throw fail("Можно импортировать только обычный набор статичных стикеров");
    // Validate all missing files before changing the catalogue. Retrying a partial DB write converges by sourceKey.
    const prepared = [];
    for (const sticker of set.stickers) {
      const key = `telegram:${name.toLowerCase()}:${sticker.file_unique_id}`;
      const existing = await find(key);
      let buffer;
      if (!existing) {
        buffer = await download(sticker);
        validate(buffer);
      }
      prepared.push({
        key,
        existing,
        buffer,
        label: `${set.title || name} ${sticker.emoji || ""}`
          .trim()
          .slice(0, 100),
      });
    }
    for (const item of prepared) {
      if (item.existing) {
        await save(item.key, { ...item.existing, active: true });
        continue;
      }
      const object = await put(item.buffer, {
        originalName: "sticker.webp",
        mimetype: "image/webp",
        prefix: "sticker",
      });
      try {
        const saved = await save(item.key, {
          ...object,
          label: item.label,
          active: true,
        });
        if (saved.name !== object.name) await remove(object.name);
      } catch (error) {
        await remove(object.name).catch(() => {});
        throw error;
      }
    }
    await publish({
      name,
      title: set.title || name,
      keys: prepared.map((item) => item.key),
    });
    return { name, title: set.title || name, count: prepared.length };
  };
const importStickerSet = async (input) => {
  const Sticker = require("../../models/messagingSticker"),
    storage = require("../storage");
  return createImporter({
    ...telegramClient(process.env.TG_TOKEN),
    find: (key) => Sticker.findOne({ sourceKey: key }).lean(),
    put: storage.putObject,
    remove: storage.deleteObject,
    publish: (pack) =>
      require("../../models/messagingStickerPack").findOneAndUpdate(
        { _id: "corporate" },
        { $set: pack },
        { upsert: true, returnDocument: "after" },
      ),
    save: async (key, fields) => {
      const insert = {
        name: fields.name,
        size: fields.size,
        label: fields.label,
      };
      try {
        return await Sticker.findOneAndUpdate(
          { sourceKey: key },
          { $setOnInsert: { ...insert, active: true } },
          { upsert: true, returnDocument: "after" },
        ).lean();
      } catch (error) {
        if (error.code !== 11000) throw error;
        return Sticker.findOne({ sourceKey: key }).lean();
      }
    },
  })(input);
};
module.exports = {
  parseSetName,
  telegramClient,
  createImporter,
  importStickerSet,
};
