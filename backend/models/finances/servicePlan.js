const mongoose = require("mongoose");

const WorkSchedule = require("../workSchedule");

const Schema = mongoose.Schema;

const PackageSchema = new Schema({
  hours: {
    type: Number,
    required: true,
    min: 0,
  },
  pricePerHour: {
    type: Number,
    required: true,
    min: 0,
  },
});

const ServicePlanSchema = new Schema(
  {
    title: {
      type: String,
      required: true,
    },
    companyWorkSchedule: { type: Boolean, default: true },
    customProvisionSchedule: WorkSchedule,
    ticketCategories: [
      {
        _id: {
          type: Schema.Types.ObjectId,
          ref: "TicketCategory",
          required: false,
        },
        title: {
          type: String,
          required: false,
        },
      },
    ],
    companies: [
      {
        _id: {
          type: Schema.Types.ObjectId,
          ref: "Company",
          required: false,
        },
        alias: {
          type: String,
          required: false,
        },
      },
    ],
    // new schema
    type: {
      type: String,
      enum: ["hourPackage", "fixedPrice", "hourly"],
      required: true,
    },
    hourPackages: [PackageSchema],
    fixedPrice: {
      type: Number,
      min: 0,
    },
    pricePerHour: {
      type: Number,
      min: 0,
    },
    pricePerHourNonWorking: {
      type: Number,
      min: 0,
    },
    packagesNonWorkingCalcMethod: {
      type: String,
      enum: ["separatePayment", "coefficient"],
    },
    packagesNonWorkingCoefficient: {
      type: Number,
      min: 0,
    },
    tariffingPeriod: {
      // minutes
      type: Number,
      min: 1,
    },
    // legacy schema
    tariffing: {
      period: {
        // minutes
        type: Number,
        min: 1,
      },
      type: {
        type: String,
        enum: ["hourPackage", "fixedPrice", "hourly"],
      },
      hourPackage: {
        packages: [PackageSchema],
        nonWorkingTime: {
          type: {
            type: String,
            enum: ["separatePayment", "coefficient"],
          },
          pricePerHour: {
            type: Number,
            min: 0,
          },
          coefficient: {
            type: Number,
            min: 0,
          },
        },
      },
      fixedPrice: {
        price: {
          type: Number,
          min: 0,
        },
        pricePerHourNonWorking: {
          type: Number,
          min: 0,
        },
      },
      hourly: {
        pricePerHour: {
          type: Number,
          min: 0,
        },
        pricePerHourNonWorking: {
          type: Number,
          min: 0,
        },
      },
    },
    //
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("ServicePlan", ServicePlanSchema);
