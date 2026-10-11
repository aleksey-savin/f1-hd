// Привязки и тип заметки базы знаний. Жили в контроллере; вынесены, потому что
// заметки заводит не только форма (controllers/knowledgeNote.js), но и
// ИИ-агент по MCP (services/mcp/knowledgeWriteSource.js).
const Company = require("../models/company");
const User = require("../models/user");
const TicketCategory = require("../models/ticketCategory");

const NOTE_TYPES = ["info", "backlog", "instructions"];

// Приводит тип заметки к допустимому значению (некорректное/пустое → "info")
const normalizeType = (type) => (NOTE_TYPES.includes(type) ? type : "info");

// Превращает массив id компаний в denormalized-массив для заметки
const buildCompanies = async (ids = []) => {
  const list = [];
  for (const id of ids) {
    if (!id) continue;
    const company = await Company.findById(id);
    if (company) {
      list.push({ _id: company._id, alias: company.alias });
    }
  }
  return list;
};

// Превращает массив id пользователей в denormalized-массив (с компанией пользователя)
const buildUsers = async (ids = []) => {
  const list = [];
  for (const id of ids) {
    if (!id) continue;
    const user = await User.findById(id);
    if (user) {
      list.push({
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        company: user.company
          ? { _id: user.company._id, alias: user.company.alias }
          : undefined,
      });
    }
  }
  return list;
};

// Превращает массив id категорий заявок в denormalized-массив
const buildCategories = async (ids = []) => {
  const list = [];
  for (const id of ids) {
    if (!id) continue;
    const category = await TicketCategory.findById(id);
    if (category) {
      list.push({ _id: category._id, title: category.title });
    }
  }
  return list;
};

module.exports = { NOTE_TYPES, normalizeType, buildCompanies, buildUsers, buildCategories };
