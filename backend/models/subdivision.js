const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const subdivisionSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: false,
    },
    phone: {
      type: String,
      required: false,
    },
    address: {
      type: String,
      required: false,
    },
    linkToMap: {
      type: String,
      required: false,
    },
    company: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
    manager: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    users: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    parent: {
      type: Schema.Types.ObjectId,
      ref: "Subdivision",
    },
    subdivisions: [
      {
        type: Schema.Types.ObjectId,
        ref: "Subdivision",
      },
    ],
  },
  { timestamps: true },
);

// Initialize arrays if they're undefined
subdivisionSchema.pre("save", function (next) {
  if (!this.users) {
    this.users = [];
  }
  if (!this.subdivisions) {
    this.subdivisions = [];
  }
  next();
});

const Subdivision = mongoose.model("Subdivision", subdivisionSchema);

module.exports = Subdivision;
