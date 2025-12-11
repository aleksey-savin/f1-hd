const mongoose = require("mongoose");

const workSchedule = require("./workSchedule");

const Schema = mongoose.Schema;

const companySchema = new Schema(
  {
    alias: {
      type: String,
      required: true,
    },
    fullTitle: {
      type: String,
      required: true,
    },
    profileImagePath: String,
    emailDomains: [
      {
        type: String,
        required: false,
      },
    ],
    phones: [
      {
        type: String,
        required: false,
      },
    ],
    address: { type: String, required: false },
    linkToMap: { type: String, required: false },
    subdivisions: [
      {
        type: Schema.Types.ObjectId,
        ref: "Subdivision",
      },
    ],
    users: [
      {
        id: {
          type: Schema.Types.ObjectId,
          ref: "User",
        },
        fullName: String,
        email: String,
        phone: String,
        position: String,
        role: String,
        isActive: Boolean,
      },
    ],
    employees: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    responsibles: [
      {
        id: {
          type: Schema.Types.ObjectId,
          ref: "User",
        },
        firstName: String,
        lastName: String,
        email: String,
        phone: String,
        position: String,
        role: String,
        isActive: Boolean,
      },
    ],
    clientsSideResponsibles: [
      {
        id: {
          type: Schema.Types.ObjectId,
          ref: "User",
        },
        firstName: String,
        lastName: String,
        email: String,
        phone: String,
        position: String,
        role: String,
        isActive: Boolean,
      },
    ],
    locationSettings: {
      allowTracking: Boolean,
      latitude: Number,
      longitude: Number,
      title: String,
      radius: Number,
    },
    workSchedule: workSchedule,
    servicePlans: [
      {
        _id: {
          type: Schema.Types.ObjectId,
          ref: "ServicePlan",
        },
        isActiveSince: Date,
        customerApprovalRequired: Boolean,
      },
    ],
    apiKeys: [
      {
        key: {
          type: String,
          required: true,
        },
        name: {
          type: String,
          required: true,
        },
        isActive: {
          type: Boolean,
          default: true,
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
        createdBy: {
          type: Schema.Types.ObjectId,
          ref: "User",
        },
      },
    ],
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
  },
  { timestamps: true },
);

const Company = mongoose.model("Company", companySchema);

module.exports = Company;
