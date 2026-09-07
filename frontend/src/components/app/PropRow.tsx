import { type ReactNode } from "react";

import { RiFileCopyLine } from "react-icons/ri";

import useToastStore from "@/store/toast-store";

// Строка «иконка · подпись · значение» карточки сущности (карточка
// пользователя, реквизиты компании): плитка-иконка, микро-подпись, значение,
// справа — опциональные действия и кнопка копирования с тостом.
export const copyText = (text: string, label: string) => {
  if (!navigator?.clipboard) return;
  navigator.clipboard.writeText(text).then(
    () => useToastStore.getState().showToast("success", `${label} скопирован`),
    () =>
      useToastStore.getState().showToast("danger", "Не удалось скопировать"),
  );
};

const PropRow = ({
  icon,
  label,
  children,
  action,
  copy,
}: {
  icon: ReactNode;
  label: ReactNode;
  children: ReactNode;
  /** Дополнительный контрол справа (иконка-кнопка такси и т. п.). */
  action?: ReactNode;
  copy?: { value: string; label: string };
}) => (
  <div className="flex items-center gap-3 border-t border-border-soft py-2.5 first:border-t-0">
    <span className="grid size-9 flex-none place-items-center rounded-lg bg-accent text-muted-foreground">
      {icon}
    </span>
    <div className="min-w-0 flex-1">
      <div className="text-xs text-faint">{label}</div>
      <div className="truncate text-sm font-medium">{children}</div>
    </div>
    {action}
    {copy && (
      <button
        type="button"
        onClick={() => copyText(copy.value, copy.label)}
        title="Скопировать"
        aria-label="Скопировать"
        className="grid size-8 flex-none cursor-pointer appearance-none place-items-center rounded-lg border-0 bg-transparent text-faint transition-colors hover:bg-accent hover:text-muted-foreground"
      >
        <RiFileCopyLine size={16} />
      </button>
    )}
  </div>
);

export default PropRow;
