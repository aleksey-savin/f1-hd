const getAuthData = require("../../middleware/getAuthData");
const ServicePlan = require("../../models/finances/servicePlan");
const TicketCategory = require("../../models/ticketCategory");
const Company = require("../../models/company");

const { AppError } = require("../../middleware/errorHandling");
const { concatIdsArray } = require("../../helpers/concatIdsArray");

exports.getAll = async (req, res, next) => {
  try {
    const servicePlans = await ServicePlan.find({}).sort({ alias: 1 });

    res.status(200).json(servicePlans);
  } catch (error) {
    next(new AppError("Failed to fetch service plans", 500, true, error));
  }
};

exports.getOne = async (req, res, next) => {
  try {
    // Карточка (View) показывает «создано …» и «обновлено … кем» — имена
    // авторов, а не ObjectId (гайд: пользователю показываем имена)
    const servicePlan = await ServicePlan.findById(req.params.id)
      .populate("createdBy", "firstName lastName")
      .populate("updatedBy", "firstName lastName");
    if (!servicePlan) {
      return next(
        new AppError(`Service plan with id ${req.params.id} not found`, 404),
      );
    }
    res.status(200).json(servicePlan);
  } catch (error) {
    next(
      new AppError(
        `Failed to fetch service plan ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.add = async (req, res, next) => {
  try {
    const { userId } = await getAuthData(req);

    const {
      title,
      companyWorkSchedule,
      customProvisionSchedule,
      ticketCategories: categories,
      companies,
      type = "",
      hourPackages = [],
      fixedPrice = null,
      pricePerHour = null,
      pricePerHourNonWorking = 0,
      packagesNonWorkingCalcMethod = "",
      packagesNonWorkingCoefficient = 1,
      tariffingPeriod = 10,
    } = req.body;

    let categoriesList = [];
    for (let id of categories) {
      let category = null;
      if (id) {
        category = await TicketCategory.findById(id);
      }

      if (category) {
        categoriesList.push(category);
      }
    }

    const servicePlan = new ServicePlan({
      title: title,
      companyWorkSchedule: companyWorkSchedule,
      customProvisionSchedule: !companyWorkSchedule
        ? customProvisionSchedule
        : {},
      ticketCategories: categoriesList,
      companies: companies,
      type: type,
      hourPackages: hourPackages,
      fixedPrice: fixedPrice,
      pricePerHour: pricePerHour,
      pricePerHourNonWorking: pricePerHourNonWorking,
      packagesNonWorkingCalcMethod: packagesNonWorkingCalcMethod,
      packagesNonWorkingCoefficient: packagesNonWorkingCoefficient,
      tariffingPeriod: tariffingPeriod,
      createdBy: userId,
      updatedBy: userId,
    });

    await servicePlan.save();

    res.status(201).json({
      message: "Service plan added successfully!",
      servicePlan: servicePlan,
    });
  } catch (error) {
    next(new AppError("Failed to add service plan", 500, true, error));
  }
};

exports.update = async (req, res, next) => {
  try {
    const {
      title,
      companyWorkSchedule,
      customProvisionSchedule,
      ticketCategories: categories,
      type = "",
      hourPackages = [],
      fixedPrice = null,
      pricePerHour = null,
      pricePerHourNonWorking = 0,
      packagesNonWorkingCalcMethod = "",
      packagesNonWorkingCoefficient = 1,
      tariffingPeriod = 10,
    } = req.body;

    const servicePlan = await ServicePlan.findById(req.params.id);

    let categoriesList = [];
    const categoriesArray = concatIdsArray(
      categories,
      servicePlan.ticketCategories,
    );
    for (let categoryId of categoriesArray) {
      const updatedCategory = await TicketCategory.findById(categoryId);
      if (updatedCategory) {
        let filteredServicePlans = updatedCategory.servicePlans.filter(
          (categoryServicePlan) =>
            categoryServicePlan._id.toString() !== servicePlan._id.toString(),
        );

        if (categories.includes(updatedCategory._id.toString())) {
          categoriesList.push(updatedCategory);
          filteredServicePlans.push(servicePlan);
        }
        updatedCategory.servicePlans = filteredServicePlans;
        await updatedCategory.save();
      }
    }

    servicePlan.title = title;
    servicePlan.companyWorkSchedule = companyWorkSchedule;
    servicePlan.customProvisionSchedule = !companyWorkSchedule
      ? customProvisionSchedule
      : {};
    servicePlan.ticketCategories = categoriesList;
    servicePlan.type = type;
    servicePlan.hourPackages = hourPackages;
    servicePlan.fixedPrice = fixedPrice;
    servicePlan.pricePerHour = pricePerHour;
    servicePlan.pricePerHourNonWorking = pricePerHourNonWorking;
    servicePlan.packagesNonWorkingCalcMethod = packagesNonWorkingCalcMethod;
    servicePlan.packagesNonWorkingCoefficient = packagesNonWorkingCoefficient;
    servicePlan.tariffingPeriod = tariffingPeriod;

    await servicePlan.save();
    res.status(200).json({
      message: "Service plan updated successfully!",
      servicePlan: servicePlan,
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to update service plan with id ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.delete = async (req, res, next) => {
  try {
    const servicePlan = await ServicePlan.findById(req.params.id);

    if (servicePlan) {
      for (let category of servicePlan.ticketCategories) {
        const updatedCategory = await TicketCategory.findById(category._id);
        if (updatedCategory) {
          const filteredServicePlans = updatedCategory.servicePlans.filter(
            (categoryServicePlan) =>
              categoryServicePlan._id.toString() !== servicePlan._id.toString(),
          );

          updatedCategory.servicePlans = filteredServicePlans;

          await updatedCategory.save();
        }
      }

      for (let company of servicePlan.companies) {
        const updatedCompany = await Company.findById(company._id);
        if (updatedCompany) {
          const filteredServicePlans = updatedCompany.servicePlans.filter(
            (companyServicePlan) =>
              companyServicePlan._id.toString() !== servicePlan._id.toString(),
          );

          updatedCompany.servicePlans = filteredServicePlans;

          await updatedCompany.save();
        }
      }

      await ServicePlan.deleteOne({ _id: req.params.id });
      res.status(204).end();
    }
  } catch (error) {
    next(
      new AppError(
        `Failed to delete service plan with id ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};
