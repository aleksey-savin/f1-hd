const mongoose = require("mongoose");
module.exports = mongoose.model(
  "MessagingSticker",
  new mongoose.Schema(
    {
      sourceKey: { type: String, unique: true, sparse: true },
      label: { type: String, required: true, maxlength: 100 },
      name: { type: String, required: true },
      size: { type: Number, required: true },
      active: { type: Boolean, default: true },
    },
    { timestamps: true },
  ),
);
