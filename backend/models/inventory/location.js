const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const locationSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ["building", "floor", "room", "workplace", "storage"],
      required: true,
    },
    description: {
      type: String,
      required: false,
    },

    // Hierarchical structure
    parent: {
      type: Schema.Types.ObjectId,
      ref: "Location",
    },
    children: [
      {
        type: Schema.Types.ObjectId,
        ref: "Location",
      },
    ],

    // Company and subdivision references
    company: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
    subdivision: {
      type: Schema.Types.ObjectId,
      ref: "Subdivision",
    },

    // Physical details
    address: {
      type: String,
      required: false,
    },
    coordinates: {
      x: Number,
      y: Number,
      floor: Number,
      room: String,
    },
    capacity: {
      type: Number, // Maximum number of devices/people
      required: false,
    },

    // For workplace type
    assignedUser: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },

    // Responsibility management
    defaultResponsible: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    responsibilityRules: {
      // Device types that have special responsibility rules in this location
      deviceTypeOverrides: [
        {
          deviceType: {
            type: Schema.Types.ObjectId,
            ref: "DeviceType",
          },
          responsibleUser: {
            type: Schema.Types.ObjectId,
            ref: "User",
          },
          responsibilityType: {
            type: String,
            enum: ["user", "manager", "it_admin", "custom"],
            default: "user",
          },
        },
      ],
      // Inherit responsibility from parent location
      inheritFromParent: {
        type: Boolean,
        default: true,
      },
    },

    // Status and metadata
    isActive: {
      type: Boolean,
      default: true,
    },
    isAccessible: {
      type: Boolean,
      default: true,
    },
    // Cross-company access
    isPublic: {
      type: Boolean,
      default: false,
      description:
        "Allows devices from other companies to be moved to this location",
    },

    // Additional metadata
    tags: [String],
    notes: String,

    // Audit fields
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  },
);

// Indexes for better performance
locationSchema.index({ company: 1, type: 1 });
locationSchema.index({ parent: 1 });
locationSchema.index({ subdivision: 1 });
locationSchema.index({ assignedUser: 1 });
locationSchema.index({ name: "text", description: "text" });

// Virtual for getting full path
locationSchema.virtual("fullPath").get(async function () {
  const path = [this.name];
  let current = this;

  while (current.parent) {
    current = await this.model("Location").findById(current.parent);
    if (current) {
      path.unshift(current.name);
    }
  }

  return path.join(" → ");
});

// Pre-save middleware to handle parent-child relationships
locationSchema.pre("save", async function (next) {
  // Initialize arrays if they're undefined
  if (!this.children) {
    this.children = [];
  }

  // If this location has a parent, add this location to parent's children
  if (this.parent && this.isNew) {
    try {
      await this.model("Location").findByIdAndUpdate(this.parent, {
        $addToSet: { children: this._id },
      });
    } catch (error) {
      return next(error);
    }
  }

  // If parent changed, update relationships
  if (this.isModified("parent") && !this.isNew) {
    const original = await this.model("Location").findById(this._id);

    // Remove from old parent
    if (original.parent) {
      await this.model("Location").findByIdAndUpdate(original.parent, {
        $pull: { children: this._id },
      });
    }

    // Add to new parent
    if (this.parent) {
      await this.model("Location").findByIdAndUpdate(this.parent, {
        $addToSet: { children: this._id },
      });
    }
  }

  next();
});

// Pre-remove middleware to clean up relationships
locationSchema.pre(
  "deleteOne",
  { document: true, query: false },
  async function (next) {
    try {
      // Remove this location from parent's children array
      if (this.parent) {
        await this.model("Location").findByIdAndUpdate(this.parent, {
          $pull: { children: this._id },
        });
      }

      // Update children to have no parent or reassign to this location's parent
      await this.model("Location").updateMany(
        { parent: this._id },
        { $set: { parent: this.parent } },
      );

      next();
    } catch (error) {
      next(error);
    }
  },
);

// Static method to get location hierarchy
locationSchema.statics.getHierarchy = async function (
  companyId,
  parentId = null,
) {
  const locations = await this.find({
    company: companyId,
    parent: parentId,
    isActive: true,
  })
    .populate("assignedUser", "firstName lastName email")
    .populate("subdivision", "name manager")
    .populate("defaultResponsible", "firstName lastName email")
    .sort({ type: 1, name: 1 });

  // Recursively get children
  for (let location of locations) {
    location.children = await this.getHierarchy(companyId, location._id);
  }

  return locations;
};

// Static method to find responsible user for a device at this location
locationSchema.statics.findResponsibleUser = async function (
  locationId,
  deviceTypeId,
) {
  const location = await this.findById(locationId)
    .populate("assignedUser")
    .populate("subdivision")
    .populate("defaultResponsible");

  if (!location) return null;

  // Check for device type specific overrides
  const override = location.responsibilityRules.deviceTypeOverrides.find(
    (rule) => rule.deviceType.toString() === deviceTypeId.toString(),
  );

  if (override && override.responsibleUser) {
    return await mongoose.model("User").findById(override.responsibleUser);
  }

  // For workplace type, return assigned user
  if (location.type === "workplace" && location.assignedUser) {
    return location.assignedUser;
  }

  // If has default responsible, return it
  if (location.defaultResponsible) {
    return location.defaultResponsible;
  }

  // If has subdivision, return subdivision manager
  if (location.subdivision?.manager) {
    return await mongoose.model("User").findById(location.subdivision.manager);
  }

  // If inherit from parent is enabled, check parent
  if (location.responsibilityRules.inheritFromParent && location.parent) {
    return await this.findResponsibleUser(location.parent, deviceTypeId);
  }

  return null;
};

// Static method to get all workplaces for a user
locationSchema.statics.getUserWorkplaces = async function (userId) {
  return await this.find({
    type: "workplace",
    assignedUser: userId,
    isActive: true,
  })
    .populate("parent", "name type")
    .populate("subdivision", "name");
};

const Location = mongoose.model("Location", locationSchema);

module.exports = Location;
