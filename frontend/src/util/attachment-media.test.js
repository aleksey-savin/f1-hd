import assert from "node:assert/strict";
import { test } from "node:test";

import { isVideoAttachment, videoAttachmentMode } from "./attachment-media.ts";

test("видео распознаётся по MIME обоих поколений и по mp4/webm без конкретного MIME", () => {
  for (const attachment of [
    { originalName: "Like4.mp4" },
    { name: "stored.WEBM", mimetype: "application/octet-stream" },
    { originalName: "record.bin", mimetype: "video/mp4" },
    { originalName: "record.mov", mimeType: "video/quicktime" },
    { originalName: "record.bin", mimetype: " VIDEO/WEBM; codecs=vp9 " },
    {
      originalName: "Like4.mp4",
      mimetype: "",
      mimeType: "application/octet-stream",
    },
  ])
    assert.equal(isVideoAttachment(attachment), true);
});

test("расширение не подменяет явный MIME другого содержимого", () => {
  for (const attachment of [
    { originalName: "Like4.mp4", mimetype: "image/png" },
    { originalName: "Like4.mp4", mimeType: "text/plain" },
    {
      originalName: "Like4.mp4",
      mimetype: "application/pdf",
      mimeType: "video/mp4",
    },
    { originalName: "record.mov" },
    { originalName: "record.mp4.exe" },
    { originalName: "document.pdf", name: "stored.mp4" },
    {},
  ])
    assert.equal(isVideoAttachment(attachment), false);
});

test("готовое видео показывается плеером, отсутствующий файл и ошибка воспроизведения возвращают файловую ссылку", () => {
  const ready = {
    name: "stored",
    originalName: "Like4.mp4",
    mimetype: "video/mp4",
    status: "ready",
  };
  assert.equal(videoAttachmentMode(ready, null), "video");
  assert.equal(videoAttachmentMode(ready, "stored"), "file");
  assert.equal(
    videoAttachmentMode({ ...ready, name: "another" }, "stored"),
    "video",
  );
  for (const status of ["pending", "failed", "skipped"])
    assert.equal(videoAttachmentMode({ ...ready, status }, null), "file");
  assert.equal(videoAttachmentMode({ ...ready, name: "" }, null), "file");
  assert.equal(
    videoAttachmentMode({ ...ready, mimetype: "application/pdf" }, null),
    "file",
  );
});
