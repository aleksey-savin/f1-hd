import { RiLock2Line } from "react-icons/ri";

// Компактный гейт прав для шторок форм и секций карточек: вместо
// полноэкранного арта — плитка-замок и текст, называющий недостающее право
// по имени (label из User/permissions-catalog.js).
const InlineForbidden = ({ right, action = "изменять записи инвентаря" }) => (
  <div className="flex flex-col items-center px-4 py-10 text-center">
    <span className="grid size-12 place-items-center rounded-xl bg-accent text-muted-foreground inset-ring inset-ring-border">
      <RiLock2Line size={22} />
    </span>
    <h4 className="mt-3.5 mb-0 text-base font-semibold">Недостаточно прав</h4>
    <p className="mt-1.5 mb-0 max-w-sm text-sm leading-relaxed text-muted-foreground">
      Чтобы {action}, нужно право{" "}
      <b className="font-medium text-foreground">«{right}»</b>. Попросите
      администратора.
    </p>
  </div>
);

export default InlineForbidden;
