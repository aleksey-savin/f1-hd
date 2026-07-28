import { BINDING_KINDS, bindingLabel } from "../../util/knowledgeNoteBindings";
import { getNoteTypeMeta } from "../../util/knowledgeNoteTypes";

// Нейтральная пилюля привязки: иконка вида + подпись. Однородные сущности
// (категория, компания, пользователь) не раскрашиваем — они различаются
// иконкой (docs/ux-ui-guide.md → «Цвет — ресурс»).
export const BindingPill = ({ kind, item }) => {
  const meta = BINDING_KINDS[kind];
  if (!meta) {
    return null;
  }
  const Icon = meta.icon;

  return (
    <span
      title={meta.title}
      className="tw:inline-flex tw:items-center tw:gap-1.5 tw:rounded-full tw:border tw:border-border tw:bg-accent tw:px-2.5 tw:py-1 tw:text-sm"
    >
      <Icon size={14} aria-hidden className="tw:text-faint" />
      {bindingLabel(kind, item)}
    </span>
  );
};

export const BindingPillList = ({ kind, items = [] }) =>
  items.map((item) => (
    <BindingPill key={item._id} kind={kind} item={item} />
  ));

// Пилюля типа заметки — та же форма, что у привязок: тип это тоже свойство,
// а не статус, и цветом он не говорит.
export const TypePill = ({ type }) => {
  const meta = getNoteTypeMeta(type);
  const Icon = meta.icon;

  return (
    <span
      title="Тип заметки"
      className="tw:inline-flex tw:items-center tw:gap-1.5 tw:rounded-full tw:border tw:border-border tw:bg-accent tw:px-2.5 tw:py-1 tw:text-sm"
    >
      <Icon size={14} aria-hidden className="tw:text-faint" />
      {meta.label}
    </span>
  );
};

// Незаполненная привязка — пунктирная пилюля-прочерк: видно, что поле есть.
export const EmptyPill = ({ kind, children }) => {
  const meta = BINDING_KINDS[kind];
  const Icon = meta?.icon;

  return (
    <span className="tw:inline-flex tw:items-center tw:gap-1.5 tw:rounded-full tw:border tw:border-dashed tw:border-border tw:px-2.5 tw:py-1 tw:text-sm tw:text-faint">
      {Icon && <Icon size={14} aria-hidden />}
      {children}
    </span>
  );
};
