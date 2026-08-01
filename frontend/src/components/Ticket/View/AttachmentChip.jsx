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
        "group/chip inline-flex max-w-full items-center gap-2 rounded-lg border border-border bg-background",
        compact ? "h-7 px-2 text-xs" : "h-8 px-2.5 text-sm",
      )}
    >
      <button
        type="button"
        onClick={open}
        title={name}
        // appearance/border/bg/p-0 явно: preflight выключен
        className="flex min-w-0 cursor-pointer appearance-none items-center gap-2 border-0 bg-transparent p-0 text-left text-inherit"
      >
        {kind === "image" ? (
          <span
            aria-hidden
            className={cn(
              "flex-none rounded-sm bg-accent bg-cover bg-center",
              compact ? "size-4" : "size-5",
            )}
            style={{ backgroundImage: `url("${fileUrl(attachment.name)}")` }}
          />
        ) : kind === "audio" ? (
          <RiMicLine className="flex-none text-faint" size={15} />
        ) : (
          <RiFileTextLine className="flex-none text-faint" size={15} />
        )}

        <span className="min-w-0 truncate">{name}</span>
        {size && <span className="flex-none text-faint">{size}</span>}
      </button>

      {onRemove && (
        <button
          type="button"
          aria-label={`Убрать «${name}»`}
          title="Удалить файл"
          onClick={() => onRemove(attachment)}
          className="flex-none cursor-pointer appearance-none rounded-sm border-0 bg-transparent p-0 text-faint opacity-0 group-hover/chip:opacity-100 focus-visible:opacity-100 hover:text-destructive pointer-coarse:opacity-100"
        >
          <RiCloseLine size={14} />
        </button>
      )}
    </span>
  );
};

export default AttachmentChip;
