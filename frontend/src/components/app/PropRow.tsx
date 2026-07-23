import { type ReactNode } from "react";

import { RiFileCopyLine } from "react-icons/ri";

import useToastStore from "@/store/toast-store";

// Строка «иконка · подпись · значение» карточки сущности (карточка
// пользователя, реквизиты компании): плитка-иконка, микро-подпись, значение,
// справа — опциональные действия и кнопка копирования с тостом.
const copyText = (text: string, label: string) => {
  if (!navigator?.clipboard) return;
  navigator.clipboard.writeText(text).then(
    () => useToastStore.getState().showToast("success", `${label} скопирован`),
    () => useToastStore.getState().showToast("danger", "Не удалось скопировать"),
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
  <div className="tw:flex tw:items-center tw:gap-3 tw:border-t tw:border-border-soft tw:py-2.5 tw:first:border-t-0">
    <span className="tw:grid tw:size-9 tw:flex-none tw:place-items-center tw:rounded-lg tw:bg-accent tw:text-muted-foreground">
      {icon}
    </span>
    <div className="tw:min-w-0 tw:flex-1">
      <div className="tw:text-xs tw:text-faint">{label}</div>
      <div className="tw:truncate tw:text-base tw:font-medium">{children}</div>
    </div>
    {action}
    {copy && (
      <button
        type="button"
        onClick={() => copyText(copy.value, copy.label)}
        title="Скопировать"
        aria-label="Скопировать"
        className="tw:grid tw:size-8 tw:flex-none tw:cursor-pointer tw:appearance-none tw:place-items-center tw:rounded-lg tw:border-0 tw:bg-transparent tw:text-faint tw:transition-colors tw:hover:bg-accent tw:hover:text-muted-foreground"
      >
        <RiFileCopyLine size={16} />
      </button>
    )}
  </div>
);

export default PropRow;
