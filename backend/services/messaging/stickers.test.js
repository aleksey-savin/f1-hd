const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validateSticker } = require("./stickers");
function webp({ animated = false, width = 512, height = 512 } = {}) {
  const b = Buffer.alloc(44);
  b.write("RIFF");
  b.writeUInt32LE(36, 4);
  b.write("WEBPVP8X", 8);
  b.writeUInt32LE(10, 16);
  b[20] = animated ? 2 : 0;
  b.writeUIntLE(width - 1, 24, 3);
  b.writeUIntLE(height - 1, 27, 3);
  b.write("VP8L", 30);
  b.writeUInt32LE(6, 34);
  b[38] = 0x2f;
  b.writeUInt32LE(((height - 1) << 14) | (width - 1), 39);
  return b;
}
test("only bounded static WebP stickers pass", () => {
  assert.doesNotThrow(() => validateSticker(webp()));
  assert.throws(() => validateSticker(webp({ animated: true })), /анимирован/);
  assert.throws(() => validateSticker(webp({ width: 1024 })), /512/);
  assert.throws(() => validateSticker(Buffer.from("fake.webp")), /WebP/);
  assert.throws(() => validateSticker(Buffer.alloc(512 * 1024 + 1)), /512 КБ/);
  assert.throws(() => validateSticker(webp().subarray(0, 25)), /WebP/);
});
const Module = require("node:module");
const modelId = require.resolve("../../models/messagingSticker");
let activeSticker;
const model = new Module(modelId);
model.loaded = true;
model.exports = {
  findOne: (filter) => {
    assert.equal(filter.active, true);
    return { lean: async () => activeSticker };
  },
};
require.cache[modelId] = model;
const { resolveSticker } = require("./stickers");
test("send only resolves active catalogue entries on supported Telegram transport", async () => {
  const id = "64f600000000000000000001",
    channel = { type: "telegram", provider: "wazzup" };
  activeSticker = { name: "stored.webp", size: 123 };
  assert.deepEqual(await resolveSticker(id, channel), {
    name: "stored.webp",
    originalName: "sticker.webp",
    mimetype: "image/webp",
    size: 123,
    status: "ready",
  });
  await assert.rejects(
    resolveSticker("../stored.webp", channel),
    /Некорректный/,
  );
  await assert.rejects(
    resolveSticker(id, { type: "whatsapp", provider: "wazzup" }),
    /Telegram/,
  );
  await assert.rejects(
    resolveSticker(id, { type: "telegram", provider: "gateway" }),
    /Wazzup/,
  );
  activeSticker = null;
  await assert.rejects(resolveSticker(id, channel), /больше не доступен/);
});
test("a WebP container without encoded image data is rejected", () => {
  const buffer = webp().subarray(0, 30);
  buffer.writeUInt32LE(22, 4);
  assert.throws(() => validateSticker(buffer), /не содержит изображения/);
});

const packId=require.resolve('../../models/messagingStickerPack');const packModule=new Module(packId);packModule.loaded=true;packModule.exports={findById:()=>({lean:async()=>null})};require.cache[packId]=packModule;
test('unpublished imported rows are excluded from a legacy catalogue',()=>{
 const {catalogueFilter}=require('./stickers');
 assert.deepEqual(catalogueFilter(null),{active:true,sourceKey:{$exists:false}});
 assert.deepEqual(catalogueFilter({keys:['telegram:new:u']}),{sourceKey:{$in:['telegram:new:u']}});
});
test('ticket sticker requires a messenger route and cannot carry a text or file draft',async()=>{
 const {ticketSticker}=require('./stickers');
 await assert.rejects(ticketSticker({stickerId:'id',route:null}),/мессенджер/);
 await assert.rejects(ticketSticker({stickerId:'id',route:{channel:{}},content:'draft',files:[]}),/отдельно/);
 assert.equal(await ticketSticker({}),null);
});
