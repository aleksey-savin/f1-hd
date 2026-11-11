import { RiAttachment2, RiCloseLine } from "react-icons/ri";

import { Button } from "@/components/ui/button";
import { formatFileSize } from "@/util/conversation-format";

/** Локальные файлы черновика — перед отправкой их можно проверить и убрать. */
const DraftAttachments = ({
  files,
  onRemove,
}: {
  files: File[];
  onRemove: (index: number) => void;
}) =>
  files.length ? (
    <div
      className="my-2 flex flex-wrap gap-1.5"
      aria-label="Вложения черновика"
    >
      {files.map((file, index) => (
        <span
          key={`${file.name}-${file.lastModified}-${index}`}
          className="inline-flex max-w-full items-center gap-1 rounded-lg border border-border bg-accent px-2 py-1 text-xs text-muted-foreground"
        >
          <RiAttachment2 size={13} aria-hidden className="flex-none" />
          <span className="truncate">{file.name}</span>
          <span className="flex-none text-faint">
            {formatFileSize(file.size)}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            title={`Убрать ${file.name}`}
            aria-label={`Убрать ${file.name}`}
            onClick={() => onRemove(index)}
          >
            <RiCloseLine />
          </Button>
        </span>
      ))}
    </div>
  ) : null;

export default DraftAttachments;
