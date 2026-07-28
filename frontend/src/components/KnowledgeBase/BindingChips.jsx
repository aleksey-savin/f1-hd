import Badge from "react-bootstrap/Badge";

import { BINDING_KINDS, bindingLabel } from "../../util/knowledgeNoteBindings";

import "../../UI/knowledgeBase.css";

// ЛЕГАСИ (bootstrap): привязки заметки на странице заявки — она ещё не
// мигрирована, tw-классы туда не добавляем. Целевой двойник — BindingPills.jsx.
// Каталог видов и подписи общие: util/knowledgeNoteBindings.js.
const BindingChip = ({ kind, item, className = "" }) => {
  const meta = BINDING_KINDS[kind];
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

// Список привязок одного вида. Пусто → ничего не рендерим.
export const BindingChipList = ({ kind, items = [], className = "" }) =>
  items.map((item) => (
    <BindingChip key={item._id} kind={kind} item={item} className={className} />
  ));

export { bindingLabel };

export default BindingChip;
