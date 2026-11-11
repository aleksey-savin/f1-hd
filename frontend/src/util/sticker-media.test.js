import test from "node:test";
import assert from "node:assert/strict";
import { stickerFormat } from "./sticker-media.js";
test("Telegram stickers use their dedicated renderer", () => {
  assert.equal(
    stickerFormat("document", { originalName: "AnimatedSticker.tgs" }),
    "tgs",
  );
  assert.equal(stickerFormat("sticker", { mimetype: "image/webp" }), "image");
  assert.equal(stickerFormat("sticker", { mimetype: "video/webm" }), "video");
  assert.equal(stickerFormat("video", { mimetype: "video/webm" }), null);
  assert.equal(stickerFormat("photo", { mimetype: "image/jpeg" }), null);
});

test("Wazzup identifies static Telegram stickers by original sticker filename", () => {
  assert.equal(
    stickerFormat("photo", {
      originalName: "sticker.webp",
      mimetype: "image/webp",
    }),
    "image",
  );
  assert.equal(
    stickerFormat("photo", {
      originalName: "holiday.webp",
      mimetype: "image/webp",
    }),
    null,
  );
});
