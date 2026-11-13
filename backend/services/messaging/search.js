const { phoneSearchDigits } = require("../phone");
const { ticketListFilter } = require("../ticketScope");
const { readsAll, messageFilter, ticketMessageFilter, scopedConversationStages } = require("./access");

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const searchTerms = (query) => {
  const text = String(query || "")
    .trim()
    .slice(0, 100)
    .replace(/([№#])\s+(?=\d)/g, "$1");
  if (!text) return [];
  return phoneSearchDigits(text).length
    ? [text]
    : text.split(/\s+/).slice(0, 8);
};
const patterns = (term) => [
  new RegExp(escapeRegex(term), "i"),
  ...phoneSearchDigits(term).map(
    (digits) => new RegExp(digits.split("").join("[\\s()+.\\-]*")),
  ),
];
const fieldMatches = (fields, regexes) =>
  fields.flatMap((field) => regexes.map((regex) => ({ [field]: regex })));
const regexExpression = (field, regex) => ({
  $regexMatch: { input: { $ifNull: [`$${field}`, ""] }, regex },
});
const ticketNumber = (term) =>
  /^(?:№|#)?\d+$/.test(term) &&
  Number.isSafeInteger(Number(term.replace(/^[№#]/, "")))
    ? Number(term.replace(/^[№#]/, ""))
    : null;
const networkNames = {
  telegram: ["telegram", "телеграм"],
  whatsapp: ["whatsapp", "ватсап", "вотсап"],
  max: ["max", "макс"],
  site: ["форма сайта", "сайт"],
};

/**
 * Search is correlated with already visible conversations, before pagination.
 * Joins return only search evidence, never extra contacts or ticket text in API.
 */
const conversationSearchPipeline = ({ filter, query, auth, limit }) => {
  const terms = searchTerms(query);
  const ticketStages = [
    { $match: { $and: [readsAll(auth) ? ticketListFilter(auth) : { _id: ticketMessageFilter(auth).ticketId }, { deletedAt: null }] } },
    {
      $project: {
        _id: 0,
        matches: terms.map((term) => ({
          $or: [
            ...["title", "description", "state"].flatMap((field) =>
              patterns(term).map((pattern) => regexExpression(field, pattern)),
            ),
            ...(ticketNumber(term) !== null
              ? [{ $eq: ["$num", ticketNumber(term)] }]
              : []),
          ],
        })),
      },
    },
  ];
  const pipeline = [
    ...scopedConversationStages(auth),
    { $match: filter },
    // Enrichment does not reorder rows. Sort first so search can stop after
    // enough matching conversations rather than joining every visible history.
    { $sort: { "lastMessage.at": -1, _id: -1 } },
    {
      $set: {
        _searchIdentityIds: {
          $setUnion: [
            {
              $cond: [
                { $ifNull: ["$counterpartIdentityId", false] },
                ["$counterpartIdentityId"],
                [],
              ],
            },
            { $ifNull: ["$participants.identityId", []] },
          ],
        },
      },
    },
    {
      $lookup: {
        from: "channelidentities",
        localField: "_searchIdentityIds",
        foreignField: "_id",
        pipeline: [
          {
            $project: {
              firstName: 1,
              lastName: 1,
              displayName: 1,
              username: 1,
              phone: 1,
              email: 1,
              userId: 1,
            },
          },
        ],
        as: "_searchContacts",
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "_searchContacts.userId",
        foreignField: "_id",
        let: {
          peerIds: {
            $map: {
              input: {
                $filter: {
                  input: "$_searchContacts",
                  as: "person",
                  cond: { $eq: ["$$person._id", "$counterpartIdentityId"] },
                },
              },
              as: "peer",
              in: "$$peer.userId",
            },
          },
        },
        // A group's HD names are visible; unrelated private HD staff contacts are not.
        pipeline: [
          {
            $project: {
              firstName: 1,
              lastName: 1,
              phone: { $cond: [{ $in: ["$_id", "$$peerIds"] }, "$phone", ""] },
              email: { $cond: [{ $in: ["$_id", "$$peerIds"] }, "$email", ""] },
            },
          },
        ],
        as: "_searchUsers",
      },
    },
    {
      $lookup: {
        from: "companies",
        localField: "companyId",
        foreignField: "_id",
        pipeline: [{ $project: { alias: 1, fullTitle: 1 } }],
        as: "_searchCompanies",
      },
    },
    {
      $lookup: {
        from: "messages",
        localField: "_id",
        foreignField: "conversationId",
        pipeline: [
          { $match: { ticketId: { $ne: null }, ...messageFilter(auth) } },
          { $group: { _id: "$ticketId" } },
        ],
        as: "_searchHistoryTickets",
      },
    },
    {
      $set: {
        _searchTicketIds: {
          $setUnion: [
            { $ifNull: ["$ticketBindings.ticketId", []] },
            {
              $cond: [
                { $ifNull: ["$binding.ticketId", false] },
                ["$binding.ticketId"],
                [],
              ],
            },
            "$_searchHistoryTickets._id",
          ],
        },
      },
    },
    {
      $lookup: {
        from: "tickets",
        localField: "_searchTicketIds",
        foreignField: "_id",
        pipeline: ticketStages,
        as: "_searchTickets",
      },
    },
    {
      $lookup: {
        from: "tickets",
        localField: "_id",
        foreignField: "originConversationId",
        pipeline: ticketStages,
        as: "_searchOriginTickets",
      },
    },
  ];
  const matches = terms.map((term, index) => {
    const regexes = patterns(term);
    const historyField = `_searchMessages${index}`;
    pipeline.push({
      $lookup: {
        from: "messages",
        localField: "_id",
        foreignField: "conversationId",
        pipeline: [
          {
            $match: {
              deletedAt: null,
              direction: { $in: ["in", "out"] },
              $and: [messageFilter(auth), { $or: fieldMatches(
                [
                  "text",
                  "authorName",
                  "attachments.originalName",
                  "form.fields.value",
                ],
                regexes,
              ) }],
            },
          },
          { $limit: 1 },
          { $project: { _id: 1 } },
        ],
        as: historyField,
      },
    });
    const handlePatterns =
      term.startsWith("@") && term.length > 1
        ? patterns(term.slice(1))
        : regexes;
    const networks = Object.entries(networkNames)
      .filter(([, labels]) =>
        labels.some((label) => label.includes(term.toLowerCase())),
      )
      .map(([network]) => network);
    return {
      $or: [
        ...fieldMatches(
          [
            "title",
            "lastMessage.preview",
            "lastMessage.authorName",
            "deliveryPhone",
            "_searchContacts.firstName",
            "_searchContacts.lastName",
            "_searchContacts.displayName",
            "_searchContacts.phone",
            "_searchContacts.email",
            "_searchUsers.firstName",
            "_searchUsers.lastName",
            "_searchUsers.phone",
            "_searchUsers.email",
            "_searchCompanies.alias",
            "_searchCompanies.fullTitle",
          ],
          regexes,
        ),
        ...fieldMatches(["_searchContacts.username"], handlePatterns),
        { _searchTickets: { $elemMatch: { [`matches.${index}`]: true } } },
        {
          _searchOriginTickets: { $elemMatch: { [`matches.${index}`]: true } },
        },
        { [`${historyField}.0`]: { $exists: true } },
        ...(networks.length ? [{ network: { $in: networks } }] : []),
      ],
    };
  });
  pipeline.push(
    { $match: { $and: matches } },
    { $limit: limit },
    {
      $unset: [
        "_searchIdentityIds",
        "_searchContacts",
        "_searchUsers",
        "_searchCompanies",
        "_searchHistoryTickets",
        "_searchTicketIds",
        "_searchTickets",
        "_searchOriginTickets",
        ...terms.map((_, index) => `_searchMessages${index}`),
      ],
    },
  );
  return pipeline;
};
module.exports = { searchTerms, conversationSearchPipeline };
