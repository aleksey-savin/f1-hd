const User = require("@/models/user");

/**
 * Отнесение работ к подразделениям клиента.
 *
 * У Work и Ticket своего поля подразделения нет — единственная связь идёт через
 * заявителя: Work.tickets[] → Ticket.applicantId (легаси: applicant._id) →
 * User.subdivision. Заявки должны приходить с populate (`loadWorks` с
 * `ticketSelect: "num applicantId applicant"`).
 *
 * Прежний разрез по подразделениям (controllers/report.js) считал подразделение
 * ИСПОЛНИТЕЛЯ работы, то есть нашего инженера. Подразделения принадлежат
 * компании клиента, наши инженеры в них не состоят — лукап промахивался, и
 * работа не попадала ни в один бакет, молча исчезая из отчёта. Здесь бакет есть
 * всегда: не разрешилось — «Без подразделения».
 *
 * Правила:
 *  - время и работы: работа целиком относится к подразделению заявки с
 *    минимальным `num` среди разрешившихся. По номеру, а не по порядку в
 *    work.tickets: порядок массива меняется при правке работы, а «по самой
 *    ранней заявке» ещё и объяснимо в интерфейсе;
 *  - заявки: каждая считается по своему подразделению, поэтому сумма по
 *    подразделениям равна числу уникальных заявок компании;
 *  - подразделение принимается, только если принадлежит компании работы —
 *    иначе (порча данных, перенос компании) уходит в «Без подразделения».
 *
 * Инвариант: итог компании = Σ подразделений + «Без подразделения».
 */

const UNASSIGNED = "__unassigned";

const idOf = (value) => (value ? (value._id ?? value).toString() : null);

const applicantIdOf = (ticket) =>
  idOf(ticket?.applicantId) || idOf(ticket?.applicant?._id) || idOf(ticket?.applicant);

/** Все id заявителей из набора работ — для одной выборки пользователей. */
const collectApplicantIds = (works) => {
  const ids = new Set();
  for (const work of works) {
    for (const ticket of work.tickets || []) {
      const applicantId = applicantIdOf(ticket);
      if (applicantId) {
        ids.add(applicantId);
      }
    }
  }
  return [...ids];
};

/**
 * @param {Array} works — работы с populate'нутыми заявками
 * @param {Map} subdivisionsById — индекс подразделений (services/subdivisionTree)
 * @returns {Promise<{
 *   subdivisionOfWork: Map<string, string>,     // workId → subdivisionId | UNASSIGNED
 *   subdivisionOfTicket: Map<string, string>,   // ticketId → subdivisionId | UNASSIGNED
 *   diagnostics: { mixedSubdivisionWorks, unresolvedTickets, worksWithoutTickets },
 * }>}
 */
const buildSubdivisionAttribution = async (works, subdivisionsById) => {
  const applicantIds = collectApplicantIds(works);
  // Имена берём той же выборкой: разрез «кто обращался» на карточке
  // подразделения обязан называть людей, а не отдавать ObjectId
  const applicants = applicantIds.length
    ? await User.find({ _id: { $in: applicantIds } })
        .select("subdivision firstName lastName")
        .lean()
    : [];

  const applicantsById = new Map(
    applicants.map((applicant) => [applicant._id.toString(), applicant]),
  );
  const subdivisionOfApplicant = new Map(
    applicants.map((applicant) => [
      applicant._id.toString(),
      idOf(applicant.subdivision),
    ]),
  );

  const subdivisionOfWork = new Map();
  const subdivisionOfTicket = new Map();
  const diagnostics = {
    mixedSubdivisionWorks: 0,
    unresolvedTickets: 0,
    worksWithoutTickets: 0,
  };

  for (const work of works) {
    const companyId = idOf(work.company);
    const tickets = work.tickets || [];

    if (tickets.length === 0) {
      diagnostics.worksWithoutTickets += 1;
      subdivisionOfWork.set(work._id.toString(), UNASSIGNED);
      continue;
    }

    const resolved = [];

    for (const ticket of tickets) {
      const ticketId = idOf(ticket);
      if (!ticketId) {
        continue;
      }
      const applicantId = applicantIdOf(ticket);
      const subdivisionId = applicantId
        ? subdivisionOfApplicant.get(applicantId)
        : null;
      const subdivision = subdivisionId
        ? subdivisionsById.get(subdivisionId)
        : null;
      // Подразделение из другой компании — данные разъехались, не засчитываем
      const belongs = subdivision && idOf(subdivision.company) === companyId;

      if (belongs) {
        subdivisionOfTicket.set(ticketId, subdivisionId);
        resolved.push({ num: ticket.num ?? Number.MAX_SAFE_INTEGER, subdivisionId });
      } else {
        subdivisionOfTicket.set(ticketId, UNASSIGNED);
        diagnostics.unresolvedTickets += 1;
      }
    }

    if (resolved.length === 0) {
      subdivisionOfWork.set(work._id.toString(), UNASSIGNED);
      continue;
    }

    const distinct = new Set(resolved.map((item) => item.subdivisionId));
    if (distinct.size > 1) {
      diagnostics.mixedSubdivisionWorks += 1;
    }

    const earliest = resolved.reduce((min, item) => (item.num < min.num ? item : min));
    subdivisionOfWork.set(work._id.toString(), earliest.subdivisionId);
  }

  return { subdivisionOfWork, subdivisionOfTicket, applicantsById, diagnostics };
};

module.exports = {
  buildSubdivisionAttribution,
  collectApplicantIds,
  applicantIdOf,
  UNASSIGNED,
};
