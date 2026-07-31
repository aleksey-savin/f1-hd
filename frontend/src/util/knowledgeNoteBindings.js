import {
  RiPriceTag3Line,
  RiBuilding2Line,
  RiAccountBoxLine,
} from "react-icons/ri";

// Привязки заметки (категория заявок / компания / пользователь) различаются
// ИКОНКОЙ, а не цветом: цвет в базе знаний отдан состоянию заметки
// (см. getNoteFlags в util/knowledgeNoteTypes.js и docs/ux-ui-guide.md).
// Каталог общий для всех мест, где привязки показываются пилюлями
// (KnowledgeBase/BindingPills — страница заметки и секция подсказок в заявке).
export const BINDING_KINDS = {
  category: { icon: RiPriceTag3Line, title: "Категория заявок" },
  company: { icon: RiBuilding2Line, title: "Компания" },
  user: { icon: RiAccountBoxLine, title: "Пользователь" },
};

export const bindingLabel = (kind, item) => {
  if (kind === "company") {
    return item.alias;
  }
  if (kind === "user") {
    return `${item.lastName || ""} ${item.firstName || ""}`.trim();
  }
  return item.title;
};
