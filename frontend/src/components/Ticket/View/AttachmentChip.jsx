import { RiCloseLine, RiFileTextLine, RiMicLine } from "react-icons/ri";

import { cn } from "@/lib/utils";

import {
  attachmentKind,
  attachmentName,
  fileUrl,
  prettySize,
} from "./attachment-utils";

/**
 * Файл заявки одной строкой: миниатюра (у картинки) или иконка · имя · размер.
 *
 * Один чип на два места — ленту под описанием и запись о вложении в хронике,
 * — потому что это один и тот же файл, показанный дважды; две вёрстки
 * разъехались бы.
 *
 * Миниатюра — `span` с `background-image`, а не `<img>`: глобальный автоскейл
 * картинок в `index.css` перебивает любые размеры у `<img>` (см. правила
 * миграции в ux-ui-guide).
 */
const AttachmentChip = ({ attachment, onOpen, onRemove, compact = false }) => {
  const kind = attachmentKind(attachment);
  const name = attachmentName(attachment);
  const size = compact ? null : prettySize(attachment.size);

  const open = () => {
    if (onOpen) return onOpen(attachment);
    window.open(fileUrl(attachment.name), "_blank", "noreferrer");
  };

  return (
    <span
      className={cn(
        "tw:group/chip tw:inline-flex tw:max-w-full tw:items-center tw:gap-2 tw:rounded-lg tw:border tw:border-border tw:bg-background",
        compact ? "tw:h-7 tw:px-2 tw:text-xs" : "tw:h-8 tw:px-2.5 tw:text-sm",
      )}
    >
      <button
        type="button"
        onClick={open}
        title={name}
        // appearance/border/bg/p-0 явно: preflight выключен
        className="tw:flex tw:min-w-0 tw:cursor-pointer tw:appearance-none tw:items-center tw:gap-2 tw:border-0 tw:bg-transparent tw:p-0 tw:text-left tw:text-inherit"
      >
        {kind === "image" ? (
          <span
            aria-hidden
            className={cn(
              "tw:flex-none tw:rounded-sm tw:bg-accent tw:bg-cover tw:bg-center",
              compact ? "tw:size-4" : "tw:size-5",
            )}
            style={{ backgroundImage: `url("${fileUrl(attachment.name)}")` }}
          />
        ) : kind === "audio" ? (
          <RiMicLine className="tw:flex-none tw:text-faint" size={15} />
        ) : (
          <RiFileTextLine className="tw:flex-none tw:text-faint" size={15} />
        )}

        <span className="tw:min-w-0 tw:truncate">{name}</span>
        {size && <span className="tw:flex-none tw:text-faint">{size}</span>}
      </button>

      {onRemove && (
        <button
          type="button"
          aria-label={`Убрать «${name}»`}
          title="Удалить файл"
          onClick={() => onRemove(attachment)}
          className="tw:flex-none tw:cursor-pointer tw:appearance-none tw:rounded-sm tw:border-0 tw:bg-transparent tw:p-0 tw:text-faint tw:opacity-0 tw:group-hover/chip:opacity-100 tw:focus-visible:opacity-100 tw:hover:text-destructive tw:pointer-coarse:opacity-100"
        >
          <RiCloseLine size={14} />
        </button>
      )}
    </span>
  );
};

export default AttachmentChip;
