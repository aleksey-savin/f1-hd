import { RiLock2Line } from "react-icons/ri";

// Компактный гейт прав для шторок форм и секций карточек: вместо
// полноэкранного арта — плитка-замок и текст, называющий недостающее право
// по имени (label из User/permissions-catalog.js).
const InlineForbidden = ({ right, action = "изменять записи инвентаря" }) => (
  <div className="tw:flex tw:flex-col tw:items-center tw:px-4 tw:py-10 tw:text-center">
    <span className="tw:grid tw:size-12 tw:place-items-center tw:rounded-xl tw:bg-accent tw:text-muted-foreground tw:inset-ring tw:inset-ring-border">
      <RiLock2Line size={22} />
    </span>
    <h4 className="tw:mt-3.5 tw:mb-0 tw:text-base tw:font-semibold">
      Недостаточно прав
    </h4>
    <p className="tw:mt-1.5 tw:mb-0 tw:max-w-sm tw:text-sm tw:leading-relaxed tw:text-muted-foreground">
      Чтобы {action}, нужно право{" "}
      <b className="tw:font-medium tw:text-foreground">«{right}»</b>. Попросите
      администратора.
    </p>
  </div>
);

export default InlineForbidden;
