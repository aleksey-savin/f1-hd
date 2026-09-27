import { useEffect, useRef, useState } from "react";
import {
  RiAttachment2,
  RiImageLine,
  RiPauseFill,
  RiPlayFill,
} from "react-icons/ri";

import { cn } from "@/lib/utils";
import type { MessageAttachment } from "@/types/conversation";
import {
  attachmentKindLabel,
  formatFileSize,
  voiceDuration,
} from "@/util/conversation-format";

/**
 * Вложения сообщения в пузыре «Диалогов» (канва A1): фото, голосовое, файл.
 * Файл сообщения шлюз кладёт в хранилище; пока он не загружен (история,
 * крупный файл — `skipped`), вместо него заглушка с видом и размером.
 */

const uploadUrl = (name: string) =>
  `${import.meta.env.VITE_API_ADDRESS ?? ""}/uploads/${name}`;

// Полосы голосового — рисунок, а не спектр: звук мы не разбираем
const WAVE = [6, 10, 16, 12, 20, 24, 14, 9, 18, 22, 26, 16, 11, 7, 13, 19, 23, 17, 12, 8, 15, 21, 13, 9, 6, 11, 15, 9, 5];

const placeholderLabel = (kind: string, attachment: MessageAttachment) => {
  if (attachment.status === "failed") {
    return `${attachmentKindLabel(kind)} не загрузилось`;
  }
  const size = formatFileSize(attachment.size);
  return size ? `${attachmentKindLabel(kind)} · ${size}` : attachmentKindLabel(kind);
};

/** Фото или его заглушка. Фон, а не <img>: глобальный хак картинок заявок в
 *  index.css (`img { width/height: auto !important }`) ломает размеры. */
export const PhotoAttachment = ({
  attachment,
  kind,
  compact = false,
}: {
  attachment: MessageAttachment;
  kind: string;
  compact?: boolean;
}) => {
  const box = compact ? "h-28 w-50" : "h-31 w-55";
  if (attachment.status !== "ready" || !attachment.name) {
    return (
      <div
        className={cn(
          "grid place-items-center rounded-[10px] bg-media-placeholder text-media-placeholder-fg",
          box,
        )}
      >
        <div className="flex flex-col items-center gap-1.5 text-xs">
          <RiImageLine size={26} aria-hidden />
          <span>{placeholderLabel(kind, attachment)}</span>
        </div>
      </div>
    );
  }
  return (
    <a
      href={uploadUrl(attachment.name)}
      target="_blank"
      rel="noreferrer"
      className="block"
    >
      <span
        role="img"
        aria-label={attachment.originalName || "Фото"}
        className={cn("block rounded-[10px] bg-cover bg-center", box)}
        style={{ backgroundImage: `url("${uploadUrl(attachment.name)}")` }}
      />
    </a>
  );
};

/** Голосовое: кнопка, полосы и длительность; проигрывает, когда файл есть. */
export const VoiceAttachment = ({
  attachment,
  compact = false,
}: {
  attachment: MessageAttachment;
  compact?: boolean;
}) => {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const ready = attachment.status === "ready" && Boolean(attachment.name);

  useEffect(() => () => audio.current?.pause(), []);

  const toggle = () => {
    const node = audio.current;
    if (!node) return;
    if (node.paused) void node.play();
    else node.pause();
  };

  return (
    <div className="flex items-center gap-2.5 py-0.5">
      <button
        type="button"
        onClick={toggle}
        disabled={!ready}
        aria-label={playing ? "Пауза" : "Прослушать голосовое"}
        title={ready ? undefined : placeholderLabel("voice", attachment)}
        className="grid size-9 flex-none cursor-pointer appearance-none place-items-center rounded-full border-0 bg-primary text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
      >
        {playing ? <RiPauseFill size={16} /> : <RiPlayFill size={16} />}
      </button>
      <span aria-hidden className="flex h-7 items-center gap-0.5">
        {(compact ? WAVE.slice(0, 20) : WAVE).map((height, index) => (
          <span
            key={index}
            className="w-0.75 flex-none rounded-xs bg-voice-wave"
            style={{ height }}
          />
        ))}
      </span>
      <span className="text-xs text-muted-foreground tabular-nums">
        {voiceDuration(attachment.durationSec)}
      </span>
      {ready && (
        <audio
          ref={audio}
          src={uploadUrl(attachment.name)}
          preload="none"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
        />
      )}
    </div>
  );
};

/** Файл — чипом, как вложение в хронике заявки. */
export const FileAttachment = ({
  attachment,
  kind,
}: {
  attachment: MessageAttachment;
  kind: string;
}) => {
  const label = attachment.originalName || attachmentKindLabel(kind);
  const chip =
    "mt-1 inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border bg-card px-2 py-1 text-xs text-muted-foreground no-underline";
  if (attachment.status !== "ready" || !attachment.name) {
    return (
      <span className={chip} title={placeholderLabel(kind, attachment)}>
        <RiAttachment2 size={13} aria-hidden />
        <span className="truncate">{label}</span>
      </span>
    );
  }
  return (
    <a
      href={uploadUrl(attachment.name)}
      target="_blank"
      rel="noreferrer"
      className={cn(chip, "hover:bg-accent")}
    >
      <RiAttachment2 size={13} aria-hidden />
      <span className="truncate">{label}</span>
    </a>
  );
};

/** Фото — отдельной подложкой пузыря (без внутренних полей); прочее — в тексте. */
export const isPhotoMessage = (kind: string, attachments: MessageAttachment[]) =>
  kind === "photo" ||
  (attachments.length > 0 &&
    attachments.every((item) => item.mimetype?.startsWith("image/")));
