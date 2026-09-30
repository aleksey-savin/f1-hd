const { phoneSearchDigits } = require("./phone");

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Условия поиска людей для `$and`: каждое слово запроса должно найтись хоть в
 * одном поле. Телефон хранится цифрами (services/phone.js), поэтому с ним
 * сравниваются цифры слова, а запрос, похожий на номер целиком («+7 (914) 555»,
 * «8 914 555 01 42»), ищется по телефону одним куском — иначе «+7» и «(914)»
 * стали бы отдельными словами. Слова экранируются и режутся по длине и числу:
 * «.*» в запросе не должно превращаться в скан.
 */
const personSearchClauses = (query, fields, maxTerms) => {
  const text = String(query ?? "").trim();
  if (!text) return [];

  const searchesPhone = fields.includes("phone");
  const phoneVariants = searchesPhone ? phoneSearchDigits(text.slice(0, 64)) : [];
  if (phoneVariants.length) {
    return [{ $or: phoneVariants.map((digits) => ({ phone: new RegExp(digits) })) }];
  }

  const textFields = fields.filter((field) => field !== "phone");
  return text
    .split(/\s+/)
    .slice(0, maxTerms)
    .map((term) => {
      const word = term.slice(0, 64);
      const pattern = new RegExp(escapeRegex(word), "i");
      const digits = word.replace(/\D/g, "");
      return {
        $or: [
          ...textFields.map((field) => ({ [field]: pattern })),
          ...(searchesPhone && digits.length >= 2 ? [{ phone: new RegExp(digits) }] : []),
        ],
      };
    });
};

module.exports = { personSearchClauses };
