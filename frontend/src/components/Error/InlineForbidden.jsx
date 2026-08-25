import { RiLock2Line } from "react-icons/ri";

import { usePermissionLabels } from "@/store/authed-user";

/**
 * Компактный гейт прав для шторок форм и секций карточек: вместо
 * полноэкранного арта — плитка-замок и текст, называющий недостающее право.
 *
 * Имя права берётся из словаря по идентификатору действия, а не пишется в
 * пропе строкой. Строкой оно уже разъехалось: в одном месте стояло «Просмотр
 * общего финансового отчёта», а в каталоге то же право звалось «Отчёты по
 * оказанным услугам», и человек шёл к администратору просить несуществующее.
 *
 * `right` — действие словаря, например `supplier.manage`. Тег `@param` здесь
 * не ставим: при деструктуризации параметра TS относит его тип ко ВСЕМУ
 * параметру, и компонент начинает требовать строку вместо пропсов.
 */
const InlineForbidden = ({ right, action = "изменять эти записи" }) => {
  const labels = usePermissionLabels();
  const name = labels[right]?.label ?? right;

  return (
    <div className="flex flex-col items-center px-4 py-10 text-center">
      <span className="grid size-12 place-items-center rounded-xl bg-accent text-muted-foreground inset-ring inset-ring-border">
        <RiLock2Line size={22} />
      </span>
      <h4 className="mt-3.5 mb-0 text-base font-semibold">Недостаточно прав</h4>
      <p className="mt-1.5 mb-0 max-w-sm text-sm leading-relaxed text-muted-foreground">
        Чтобы {action}, нужно право{" "}
        <b className="font-medium text-foreground">«{name}»</b>. Попросите
        администратора.
      </p>
    </div>
  );
};

export default InlineForbidden;
