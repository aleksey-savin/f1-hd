const Router = require("express");
const router = new Router();
const Company = require("../../models/company");
const User = require("../../models/user");
const DeviceType = require("../../models/inventory/deviceType");
const Vendor = require("../../models/inventory/vendor");
const Location = require("../../models/inventory/location");
const isAuth = require("../../middleware/isAuth");
const {
  canUseInventoryModule,
  inventoryModuleIsActive,
} = require("../../middleware/permissions");
const { AppError } = require("../../middleware/errorHandling");

// Get all companies for dropdown
router.get(
  "/reference/companies",
  isAuth,
  inventoryModuleIsActive,
  canUseInventoryModule,
  async (req, res, next) => {
    try {
      const companies = await Company.find({}, "alias fullTitle").sort({
        alias: 1,
      });
      res.status(200).json(companies);
    } catch (error) {
      next(new AppError("Failed to fetch companies", 500, true, error));
    }
  },
);

// Get users by company for dropdown
router.get(
  "/reference/companies/:companyId/users",
  isAuth,
  inventoryModuleIsActive,
  canUseInventoryModule,
  async (req, res, next) => {
    try {
      const { companyId } = req.params;

      const company = await Company.findById(companyId);
      if (!company) {
        return next(new AppError("Company not found", 404));
      }

      // Get users from company.users array
      const users = company.users
        .filter((user) => user.isActive)
        .map((user) => ({
          _id: user.id,
          firstName: user.fullName?.split(" ")[0] || "",
          lastName: user.fullName?.split(" ").slice(1).join(" ") || "",
          email: user.email,
          fullName: user.fullName,
        }));

      res.status(200).json(users);
    } catch (error) {
      next(new AppError("Failed to fetch company users", 500, true, error));
    }
  },
);

// Get all device types for dropdown
router.get(
  "/reference/device-types",
  isAuth,
  inventoryModuleIsActive,
  canUseInventoryModule,
  async (req, res, next) => {
    try {
      const deviceTypes = await DeviceType.find(
        { isActive: true },
        "name description",
      ).sort({ name: 1 });
      res.status(200).json(deviceTypes);
    } catch (error) {
      next(new AppError("Failed to fetch device types", 500, true, error));
    }
  },
);

// Get all vendors for dropdown
router.get(
  "/reference/vendors",
  isAuth,
  inventoryModuleIsActive,
  canUseInventoryModule,
  async (req, res, next) => {
    try {
      const vendors = await Vendor.find(
        { isActive: true },
        "name description",
      ).sort({ name: 1 });
      res.status(200).json(vendors);
    } catch (error) {
      next(new AppError("Failed to fetch vendors", 500, true, error));
    }
  },
);

// Get all locations for dropdown
router.get(
  "/reference/locations",
  isAuth,
  inventoryModuleIsActive,
  canUseInventoryModule,
  async (req, res, next) => {
    try {
      const { companyId } = req.query;

      const query = { isActive: true };
      if (companyId) {
        query.company = companyId;
      }

      const locations = await Location.find(query)
        .populate("parent", "name type")
        .sort({ type: 1, name: 1 });

      const formattedLocations = locations.map((location) => ({
        _id: location._id,
        name: location.name,
        type: location.type,
        description: location.description,
        fullPath: location.parent
          ? `${location.parent.name} → ${location.name}`
          : location.name,
        parent: location.parent,
      }));

      res.status(200).json(formattedLocations);
    } catch (error) {
      next(new AppError("Failed to fetch locations", 500, true, error));
    }
  },
);

// Get locations and users combined for device assignment
router.get(
  "/reference/assignment-options",
  isAuth,
  inventoryModuleIsActive,
  canUseInventoryModule,
  async (req, res, next) => {
    try {
      const { companyId } = req.query;

      if (!companyId) {
        return next(new AppError("Company ID is required", 400));
      }

      // Helper function to get location type label
      const getLocationTypeLabel = (type) => {
        const labels = {
          building: "Здание",
          floor: "Этаж",
          room: "Помещение",
          workplace: "Рабочее место",
          storage: "Склад",
        };
        return labels[type] || type;
      };

      // Получаем расположения компании
      const locations = await Location.find({
        company: companyId,
        isActive: true,
      })
        .populate("parent", "name type")
        .sort({ type: 1, name: 1 });

      // Получаем пользователей компании с их рабочими местами
      const company = await Company.findById(companyId).populate({
        path: "employees",
        match: { isActive: true },
        select: "firstName lastName email",
      });

      if (!company) {
        return next(new AppError("Company not found", 404));
      }

      // Получаем рабочие места пользователей
      const userIds = company.employees.map((emp) => emp._id);
      const workplaces = await Location.find({
        type: "workplace",
        assignedUser: { $in: userIds },
        isActive: true,
      });

      const workplaceMap = {};
      workplaces.forEach((workplace) => {
        workplaceMap[workplace.assignedUser.toString()] = workplace;
      });

      // Формируем опции для селекта
      const options = [];

      // Добавляем группу "Расположения"
      const locationOptions = locations
        .filter((location) => location.type !== "workplace")
        .map((location) => {
          const typeLabel = getLocationTypeLabel(location.type);
          const baseName = location.parent
            ? `${location.parent.name} → ${location.name}`
            : location.name;
          return {
            value: location._id.toString(),
            label: `${baseName} (${typeLabel})`,
            type: "location",
            locationData: {
              _id: location._id,
              name: location.name,
              type: location.type,
              description: location.description,
            },
          };
        });

      if (locationOptions.length > 0) {
        options.push({
          label: "Расположения",
          options: locationOptions,
        });
      }

      // Добавляем группу "Пользователи (рабочие места)"
      const userOptions = company.employees
        .filter((user) => workplaceMap[user._id.toString()])
        .map((user) => {
          const workplace = workplaceMap[user._id.toString()];
          return {
            value: `user_${user._id}`,
            label:
              `${user.firstName} ${user.lastName || ""} (${user.email})`.trim(),
            type: "user",
            userData: {
              _id: user._id,
              firstName: user.firstName,
              lastName: user.lastName,
              email: user.email,
              workplace: {
                _id: workplace._id,
                name: workplace.name,
              },
            },
          };
        });

      if (userOptions.length > 0) {
        options.push({
          label: "Пользователи (рабочие места)",
          options: userOptions,
        });
      }

      res.status(200).json(options);
    } catch (error) {
      next(
        new AppError("Failed to fetch assignment options", 500, true, error),
      );
    }
  },
);

module.exports = router;
