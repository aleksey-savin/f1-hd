const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const pro32ConnectionSchema = new Schema(
  {
    user: {
      _id: {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
      firstName: String,
      lastName: String,
    },
    ticket: Number,
    getScreenId: Number,
    status: Number,
    createTime: Number,
    inviteCode: String,
    inviteUrl: String,
    connectUrl: String,
    clientName: String,
    clientOs: String,
    clientPreviewUrl: String,
  },
  { timestamps: true },
);

module.exports = mongoose.model("Pro32Connection", pro32ConnectionSchema);
