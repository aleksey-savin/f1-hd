const { AppError } = require("../../middleware/errorHandling");
const invalid = (message) => {
  throw new AppError(message, 400);
};
/** Inspect WebP chunks, not the client-provided MIME or filename. */
const validateSticker = (buffer) => {
  if (buffer.length > 512 * 1024)
    invalid("Стикер должен быть не больше 512 КБ");
  if (
    buffer.length < 30 ||
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WEBP" ||
    buffer.readUInt32LE(4) + 8 !== buffer.length
  )
    invalid("Загрузите статичный стикер WebP");
  let width = 0,
    height = 0,
    image = false;
  for (let offset = 12; offset < buffer.length; ) {
    if (offset + 8 > buffer.length) invalid("Повреждённый WebP");
    const type = buffer.toString("ascii", offset, offset + 4),
      size = buffer.readUInt32LE(offset + 4),
      start = offset + 8;
    if (start + size > buffer.length) invalid("Повреждённый WebP");
    if (
      type === "ANIM" ||
      type === "ANMF" ||
      (type === "VP8X" && size >= 10 && buffer[start] & 2)
    )
      invalid("Набор не поддерживает анимированные стикеры");
    if (type === "VP8X" && size >= 10) {
      width = buffer.readUIntLE(start + 4, 3) + 1;
      height = buffer.readUIntLE(start + 7, 3) + 1;
    }
    if (
      type === "VP8 " &&
      size > 10 &&
      buffer
        .subarray(start + 3, start + 6)
        .equals(Buffer.from([0x9d, 0x01, 0x2a]))
    ) {
      image = true;
      width = buffer.readUInt16LE(start + 6) & 0x3fff;
      height = buffer.readUInt16LE(start + 8) & 0x3fff;
    }
    if (type === "VP8L" && size > 5 && buffer[start] === 0x2f) {
      image = true;
      const bits = buffer.readUInt32LE(start + 1);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
    }
    offset = start + size + (size % 2);
  }
  if (!image) invalid("WebP не содержит изображения");
  if (
    !width ||
    !height ||
    width > 512 ||
    height > 512 ||
    Math.max(width, height) !== 512
  )
    invalid(
      "Одна сторона стикера должна быть 512 px, другая — не больше 512 px",
    );
};
const catalogueFilter = pack => pack ? {sourceKey: {$in:pack.keys}} : {active:true,sourceKey:{$exists:false}};
const resolveSticker = async (id, channel) => {
  if (channel.type !== "telegram" || channel.provider !== "wazzup")
    throw new AppError(
      "Отправка стикеров доступна для Telegram через Wazzup",
      400,
    );
  if (typeof id !== "string" || !/^[a-f\d]{24}$/i.test(id))
    invalid("Некорректный стикер");
  const pack = await require("../../models/messagingStickerPack")
    .findById("corporate")
    .lean();
  const sticker = await require("../../models/messagingSticker")
    .findOne({
      _id: id,
      ...catalogueFilter(pack),
    })
    .lean();
  if (!sticker) throw new AppError("Стикер больше не доступен в наборе", 404);
  return {
    name: sticker.name,
    originalName: "sticker.webp",
    mimetype: "image/webp",
    size: sticker.size,
    status: "ready",
  };
};
module.exports = { validateSticker, resolveSticker, catalogueFilter };

const ticketSticker = async ({stickerId, route, content, files=[]}) => {
 if(!stickerId)return null;
 if(!route)throw new AppError("Выберите мессенджер для отправки стикера",400);
 if((content && content!=="Стикер") || files.length)throw new AppError("Стикер отправляется отдельно от текста и файлов",400);
 return resolveSticker(stickerId,route.channel);
};
module.exports.ticketSticker=ticketSticker;
