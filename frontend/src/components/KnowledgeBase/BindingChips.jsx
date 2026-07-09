import Badge from "react-bootstrap/Badge";

import {
  RiPriceTag3Line,
  RiBuilding2Line,
  RiAccountBoxLine,
} from "react-icons/ri";

import "../../UI/knowledgeBase.css";

// Привязки заметки (категория заявок / компания / пользователь) различаются
// иконкой, а не цветом: цвет в базе знаний зарезервирован за типом заметки,
// состоянием проверки и опасными действиями. Раньше категории красились в
// bg="info" — на тёмной теме это плохо читается (см. docs/ux-ui-guide.md).
const CHIP_KINDS = {
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

const BindingChip = ({ kind, item, className = "" }) => {
  const meta = CHIP_KINDS[kind];
  if (!meta) {
    return null;
  }
  const Icon = meta.icon;

  return (
    <Badge
      bg="secondary"
      title={meta.title}
      className={`kb-chip fw-normal ${className}`}
    >
      <Icon aria-hidden="true" /> {bindingLabel(kind, item)}
    </Badge>
  );
};

// Список привязок одного вида. Пусто → ничего не рендерим: за прочерк отвечает
// вызывающая строка свойств.
export const BindingChipList = ({ kind, items = [], className = "" }) =>
  items.map((item) => (
    <BindingChip key={item._id} kind={kind} item={item} className={className} />
  ));

export default BindingChip;
