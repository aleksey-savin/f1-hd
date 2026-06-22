const Location = require("../../models/inventory/location");
const Subdivision = require("../../models/subdivision");
const User = require("../../models/user");
const Company = require("../../models/company");
const ClientDevice = require("../../models/inventory/clientDevice");
const { AppError } = require("../../middleware/errorHandling");
const getAuthData = require("../../middleware/getAuthData");

exports.getAll = async (req, res, next) => {
  try {
    const locations = await Location.find({})
      .populate("company", "alias fullTitle")
      .populate({
        path: "subdivision",
        select: "name manager",
        populate: {
          path: "manager",
          select: "firstName lastName email",
        },
      })
      .populate("assignedUser", "firstName lastName email")
      .populate("defaultResponsible", "firstName lastName email")
      .populate("parent", "name type")
      .sort({ type: 1, name: 1 });

    res.status(200).json(locations);
  } catch (error) {
    next(new AppError("Failed to fetch locations", 500, true, error));
  }
};

// Get locations for one or multiple companies
// Supports: ?companyId=123 (single) or ?companyIds=123,456,789 (multiple)
exports.getAllCompanies = async (req, res, next) => {
  try {
    const { companyIds } = req.query;

    const authedUser = await getAuthData(req);

    let companyFilter = {};

    if (companyIds) {
      const idsArray = companyIds.split(",").filter(Boolean);
      companyFilter = { company: { $in: idsArray } };
    } else {
      // Default to user's company
      companyFilter = { company: authedUser.company?._id };
    }

    const locations = await Location.find(companyFilter)
      .populate("company", "alias fullTitle")
      .populate({
        path: "subdivision",
        select: "name manager",
        populate: {
          path: "manager",
          select: "firstName lastName email",
        },
      })
      .populate("assignedUser", "firstName lastName email")
      .populate("defaultResponsible", "firstName lastName email")
      .populate("parent", "name type")
      .sort({ type: 1, name: 1 });

    res.status(200).json(locations);
  } catch (error) {
    next(new AppError("Failed to fetch locations", 500, true, error));
  }
};

// Get location hierarchy
exports.getHierarchy = async (req, res, next) => {
  try {
    const { companyId } = req.query;
    const targetCompanyId = companyId || req.user.company;

    const hierarchy = await Location.getHierarchy(targetCompanyId);
    res.status(200).json(hierarchy);
  } catch (error) {
    next(new AppError("Failed to fetch location hierarchy", 500, true, error));
  }
};

// Get one location by ID
exports.getOne = async (req, res, next) => {
  try {
    const location = await Location.findById(req.params.id)
      .populate("company", "alias fullTitle")
      .populate({
        path: "subdivision",
        select: "name manager",
        populate: {
          path: "manager",
          select: "firstName lastName email",
        },
      })
      .populate("assignedUser", "firstName lastName email")
      .populate("defaultResponsible", "firstName lastName email")
      .populate("parent", "name type")
      .populate("children", "name type");

    if (!location) {
      return next(
        new AppError(`Location with id ${req.params.id} not found`, 404),
      );
    }

    // Get devices in this location
    const devices = await ClientDevice.find({
      location: req.params.id,
      isDeleted: { $ne: true },
    })
      .populate("deviceType", "name")
      .populate("vendor", "name")
      .select("model serialNumber status");

    res.status(200).json({
      location,
      devices,
      deviceCount: devices.length,
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to fetch location ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

// Create new location
exports.add = async (req, res, next) => {
  try {
    const {
      name,
      type,
      company,
      subdivision,
      parent,
      assignedUser,
      defaultResponsible,
      address,
      coordinates,
      responsibilityRules,
      description,
      isPublic,
      tags,
      notes,
    } = req.body;

    const authedUser = await getAuthData(req);

    // Validation: assignedUser only for workplace type
    if (type !== "workplace" && assignedUser) {
      return next(
        new AppError(
          "assignedUser can only be set for workplace type locations",
          400,
        ),
      );
    }

    if (type === "workplace" && !assignedUser) {
      return next(
        new AppError(
          "assignedUser is required for workplace type locations",
          400,
        ),
      );
    }

    // Use provided company or default to user's company
    const targetCompanyId = company || req.user.company;

    // Check if user belongs to the same company
    if (assignedUser) {
      const user = await User.findById(assignedUser);
      // company у User — вложенный объект { _id, alias }; сравниваем по _id
      // (с фолбэком на сырой ObjectId для непопулированных/legacy данных).
      const userCompanyId = user?.company?._id || user?.company;
      if (!user || userCompanyId?.toString() !== targetCompanyId.toString()) {
        return next(
          new AppError("Assigned user must belong to the same company", 400),
        );
      }
    }

    // Check if subdivision belongs to the same company
    if (subdivision) {
      const sub = await Subdivision.findById(subdivision);
      if (!sub || sub.company.toString() !== targetCompanyId.toString()) {
        return next(
          new AppError("Subdivision must belong to the same company", 400),
        );
      }
    }

    // Check if parent exists and belongs to the same company
    if (parent) {
      const parentLocation =
        await Location.findById(parent).populate("company");
      if (
        !parentLocation ||
        parentLocation.company.toString() !== targetCompanyId.toString()
      ) {
        return next(
          new AppError("Parent location must belong to the same company", 400),
        );
      }
    }

    const location = new Location({
      name,
      type,
      company: targetCompanyId,
      subdivision,
      parent,
      assignedUser,
      defaultResponsible,
      address,
      coordinates,
      responsibilityRules: responsibilityRules || {
        inheritFromParent: true,
        deviceTypeOverrides: [],
      },
      description,
      isPublic: isPublic || false,
      tags: tags || [],
      notes,
      createdBy: req.userId,
    });

    await location.save();

    // Populate the response
    await location.populate([
      { path: "company", select: "alias fullTitle" },
      {
        path: "subdivision",
        select: "name manager",
        populate: {
          path: "manager",
          select: "firstName lastName email",
        },
      },
      { path: "assignedUser", select: "firstName lastName email" },
      { path: "defaultResponsible", select: "firstName lastName email" },
      { path: "parent", select: "name type" },
    ]);

    res.status(201).json({
      message: "Расположение успешно создано",
      location,
    });
  } catch (error) {
    if (error.code === 11000) {
      return next(
        new AppError(
          "Location with this name already exists in the company",
          409,
        ),
      );
    }
    next(new AppError("Failed to create location", 500, true, error));
  }
};

// Update location
exports.update = async (req, res, next) => {
  try {
    const location = await Location.findById(req.params.id).populate("company");

    if (!location) {
      return next(
        new AppError(`Location with id ${req.params.id} not found`, 404),
      );
    }

    const authedUser = await getAuthData(req);

    const {
      name,
      type,
      company,
      subdivision,
      parent,
      assignedUser,
      defaultResponsible,
      address,
      coordinates,
      capacity,
      responsibilityRules,
      description,
      securityLevel,
      isActive,
      isAccessible,
      isPublic,
      tags,
      notes,
    } = req.body;

    // Validation: assignedUser only for workplace type
    if (type !== "workplace" && assignedUser) {
      return next(
        new AppError(
          "assignedUser can only be set for workplace type locations",
          400,
        ),
      );
    }

    if (type === "workplace" && !assignedUser) {
      return next(
        new AppError(
          "assignedUser is required for workplace type locations",
          400,
        ),
      );
    }

    // Назначаемый пользователь должен быть из той же компании. company может
    // меняться в этом же запросе — берём новое значение, иначе текущую компанию
    // локации (она populated). Сравнение по user.company._id (см. add).
    if (assignedUser) {
      const user = await User.findById(assignedUser);
      const userCompanyId = user?.company?._id || user?.company;
      const targetCompanyId =
        company || location.company?._id || location.company;
      if (!user || userCompanyId?.toString() !== targetCompanyId?.toString()) {
        return next(
          new AppError("Assigned user must belong to the same company", 400),
        );
      }
    }

    // Prevent creating circular references in parent-child relationships
    if (parent && parent.toString() === req.params.id) {
      return next(new AppError("Location cannot be its own parent", 400));
    }

    // Update fields
    if (name !== undefined) location.name = name;
    if (type !== undefined) location.type = type;
    if (company !== undefined) location.company = company;
    if (subdivision !== undefined) location.subdivision = subdivision;
    if (parent !== undefined) location.parent = parent;
    if (assignedUser !== undefined) location.assignedUser = assignedUser;
    if (defaultResponsible !== undefined)
      location.defaultResponsible = defaultResponsible;
    if (address !== undefined) location.address = address;
    if (coordinates !== undefined) location.coordinates = coordinates;
    if (capacity !== undefined) location.capacity = capacity;
    if (responsibilityRules !== undefined)
      location.responsibilityRules = responsibilityRules;
    if (description !== undefined) location.description = description;
    if (securityLevel !== undefined) location.securityLevel = securityLevel;
    if (isActive !== undefined) location.isActive = isActive;
    if (isAccessible !== undefined) location.isAccessible = isAccessible;
    if (isPublic !== undefined) location.isPublic = isPublic;
    if (tags !== undefined) location.tags = tags;
    if (notes !== undefined) location.notes = notes;

    location.updatedBy = authedUser._id;

    await location.save();

    // Populate the response
    await location.populate([
      { path: "subdivision", select: "name manager" },
      { path: "assignedUser", select: "firstName lastName email" },
      { path: "defaultResponsible", select: "firstName lastName email" },
      { path: "parent", select: "name type" },
    ]);

    res.status(200).json({
      message: "Расположение успешно обновлено",
      location,
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to update location ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

// Soft delete location
exports.delete = async (req, res, next) => {
  try {
    const location = await Location.findById(req.params.id).populate("company");

    if (!location) {
      return next(
        new AppError(`Location with id ${req.params.id} not found`, 404),
      );
    }

    // Check if location has devices
    const deviceCount = await ClientDevice.countDocuments({
      location: req.params.id,
      isDeleted: { $ne: true },
    });

    if (deviceCount > 0) {
      return next(
        new AppError(
          `Cannot delete location with ${deviceCount} devices. Please move devices first.`,
          400,
        ),
      );
    }

    // Check if location has children
    if (location.children && location.children.length > 0) {
      return next(
        new AppError(
          "Cannot delete location with child locations. Please delete or move child locations first.",
          400,
        ),
      );
    }

    await location.deleteOne();

    res.status(200).json({
      message: "Расположение успешно удалено",
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to delete location ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

// Get workplaces for a specific user
exports.getUserWorkplaces = async (req, res, next) => {
  try {
    const { userId } = req.params;

    const workplaces = await Location.getUserWorkplaces(userId);

    res.status(200).json(workplaces);
  } catch (error) {
    next(
      new AppError(
        `Failed to fetch workplaces for user ${req.params.userId}`,
        500,
        true,
        error,
      ),
    );
  }
};

// Get devices in a location
exports.getLocationDevices = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { includeChildren } = req.query;

    let locationIds = [id];

    // If includeChildren is true, get all child locations recursively
    if (includeChildren === "true") {
      const location = await Location.findById(id);
      if (location) {
        const children = await location.getAllChildren();
        locationIds = locationIds.concat(children.map((child) => child._id));
      }
    }

    const devices = await ClientDevice.find({
      location: { $in: locationIds },
      isDeleted: { $ne: true },
    })
      .populate("deviceType", "name category")
      .populate("vendor", "name")
      .populate("location", "name type")
      .sort({ model: 1 });

    res.status(200).json({
      devices,
      totalCount: devices.length,
      locationIds,
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to fetch devices for location ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

// Move devices between locations
exports.moveDevices = async (req, res, next) => {
  try {
    const { deviceIds, targetLocationId, reason } = req.body;

    if (!deviceIds || !Array.isArray(deviceIds) || deviceIds.length === 0) {
      return next(new AppError("Device IDs are required", 400));
    }

    if (!targetLocationId) {
      return next(new AppError("Target location ID is required", 400));
    }

    // Verify target location exists and belongs to user's company
    const targetLocation =
      await Location.findById(targetLocationId).populate("company");
    if (!targetLocation) {
      return next(new AppError("Target location not found", 404));
    }

    if (targetLocation.company.toString() !== req.user.company.toString()) {
      return next(
        new AppError("Target location must belong to your company", 403),
      );
    }

    // Update devices
    const updateResult = await ClientDevice.updateMany(
      {
        _id: { $in: deviceIds },
        company: req.user.company,
        isDeleted: { $ne: true },
      },
      {
        location: targetLocationId,
        updatedBy: req.userId,
      },
    );

    // TODO: Handle responsibility changes for each device
    // This would need to be implemented with the DeviceResponsibility model

    res.status(200).json({
      message: `${updateResult.modifiedCount} устройств успешно перемещено`,
      movedCount: updateResult.modifiedCount,
      targetLocation: {
        _id: targetLocation._id,
        name: targetLocation.name,
        type: targetLocation.type,
      },
    });
  } catch (error) {
    next(new AppError("Failed to move devices", 500, true, error));
  }
};

// Get location statistics
exports.getLocationStats = async (req, res, next) => {
  try {
    const { companyId } = req.query;
    const targetCompanyId = companyId || req.user.company;

    const stats = await Location.aggregate([
      {
        $match: {
          company: mongoose.Types.ObjectId(targetCompanyId),
          isDeleted: { $ne: true },
        },
      },
      {
        $group: {
          _id: "$type",
          count: { $sum: 1 },
        },
      },
    ]);

    // Get device count per location type
    const deviceStats = await ClientDevice.aggregate([
      {
        $match: {
          company: mongoose.Types.ObjectId(targetCompanyId),
          isDeleted: { $ne: true },
        },
      },
      {
        $lookup: {
          from: "locations",
          localField: "location",
          foreignField: "_id",
          as: "locationInfo",
        },
      },
      {
        $unwind: {
          path: "$locationInfo",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $group: {
          _id: "$locationInfo.type",
          deviceCount: { $sum: 1 },
          totalValue: { $sum: "$currentValue" },
        },
      },
    ]);

    res.status(200).json({
      locationStats: stats,
      deviceStats,
    });
  } catch (error) {
    next(new AppError("Failed to fetch location statistics", 500, true, error));
  }
};
