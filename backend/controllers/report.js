const Company = require("../models//company");
const User = require("../models//user");
const Category = require("../models//ticketCategory");
const Work = require("../models//work");
const { Ticket } = require("../models//ticket");
const getAuthData = require("../middleware/getAuthData");

const { AppError } = require("../middleware/errorHandling");

exports.getFormData = async (req, res, next) => {
  try {
    const authedUser = await getAuthData(req);

    let companies = [];

    if (!authedUser.isEndUser) {
      companies = await Company.find({}).sort({ alias: 1 });
    } else {
      companies = await Company.find({ _id: authedUser.company._id });
    }

    const categories = await Category.find({ isActive: true }).sort({
      title: 1,
    });

    const perfomers = await User.find({
      $and: [{ "permissions.canPerformTickets": true }, { isActive: true }],
    });

    res.status(200).json({
      message: "Form data fetched successfully",
      companies: companies,
      categories: categories,
      perfomers: perfomers,
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to fetch tickets report form data`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.filterWorks = async (req, res, next) => {
  try {
    const { company, category, from, to } = req.body;

    const fromDate = new Date(from);

    let toDate = new Date(to);
    toDate = toDate.setDate(toDate.getDate() + 1);

    const works = await Work.find({
      company: company._id,
      finishedAt: { $gte: fromDate, $lte: toDate },
    });

    let worksData = [];

    for (let work of works) {
      const tickets = await Ticket.find({
        _id: { $in: work.tickets },
      })
        .populate("categoryId")
        .populate("applicantId");

      const ticketsNums = tickets?.map((ticket) => ticket.num);
      const ticketsApplicants = tickets?.map(
        (ticket) =>
          `${ticket.applicantId?.lastName} ${ticket.applicantId?.firstName}`,
      );
      const ticketsCategories = tickets?.map((ticket) => ({
        _id: ticket.categoryId?._id.toString(),
        title: ticket.categoryId.title,
      }));

      if (Object.keys(category).length === 0) {
        worksData.push({
          _id: work._id,
          ticketsNums: ticketsNums || [],
          ticketsApplicants: ticketsApplicants || [],
          ticketsCategories: ticketsCategories || [],
          description: work.description,
          finishedBy: `${work.finishedBy?.lastName} ${work.finishedBy?.firstName}`,
          startedAt: work.startedAt,
          finishedAt: work.finishedAt,
        });
      } else {
        if (
          ticketsCategories
            .map((category) => category._id)
            .includes(category._id.toString())
        ) {
          worksData.push({
            _id: work._id,
            ticketsNums: ticketsNums || [],
            ticketsApplicants: ticketsApplicants || [],
            ticketsCategories:
              ticketsCategories.map((category) => category.title) || [],
            description: work.description,
            finishedBy: `${work.finishedBy?.lastName} ${work.finishedBy?.firstName}`,
            startedAt: work.startedAt,
            finishedAt: work.finishedAt,
          });
        }
      }
    }

    const totalTime = (works) => {
      let total = 0;
      for (let work of works) {
        const duration = new Date(work.finishedAt) - new Date(work.startedAt);

        total += duration;
      }
      return total;
    };

    res.status(200).json({
      totalTime: totalTime(worksData),
      works: worksData,
    });
  } catch (error) {
    next(new AppError(`Failed to filter works for report`, 500, true, error));
  }
};
