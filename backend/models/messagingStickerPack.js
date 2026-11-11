const mongoose = require("mongoose");
module.exports = mongoose.model(
  "MessagingStickerPack",
  new mongoose.Schema(
    {
      _id: { type: String, default: "corporate", enum: ["corporate"] },
      name: { type: String, required: true },
      title: { type: String, required: true },
      keys: { type: [String], required: true },
    },
    { timestamps: true },
  ),
);
