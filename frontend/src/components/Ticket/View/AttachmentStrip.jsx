import { useState } from "react";

import {
  RiAttachment2,
  RiDeleteBinLine,
  RiDownloadLine,
  RiFileTextLine,
  RiVoiceprintLine,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import useHttp from "../../../hooks/use-http";
import useInitialPrefsStore from "../../../store/prefs";
import useToastStore from "../../../store/toast-store";
import useViewTicketStore from "../../../store/view-ticket";

import AttachmentChip from "./AttachmentChip";
import { attachmentKind, attachmentName, fileUrl } from "./attachment-utils";
import { useCan } from "@/store/authed-user";

/**
 * Вложения заявки — лента в подвале секции «Описание», а не своя секция.
 *
 * Почему так: вложение почти всегда приходит вместе с заявкой (скриншот, акт,
 * запись звонка), дальше его читают по ходу дела, а новое кладут в комментарий.
 * По смыслу это часть описания проблемы, а не отдельный предмет, — и рамка на
 * каждый файл с развёрнутым плеером стоила около 310 px вертикали в колонке,
 * где ниже чек-лист, работы, окружение и база знаний.
 *
 * Аудио — единственное исключение: запись слушают на месте, поэтому она
 * занимает всю ширину строки и держит плеер. Плеер нативный, а не
 * react-h5-audio-player: у той библиотеки в поставляемой RC нет defaultProps, и
 * без явного progressJumpSteps перемотка роняет приложение.
 *
 * Пустого состояния нет вовсе: строка «Вложений нет» не сообщает ничего, а у
 * большинства заявок файлов и не бывает. Кнопка «Прикрепить» при этом на месте
 * — её отдаёт `uploadAction` в метку секции.
 */

const VISIBLE_LIMIT = 4;

export const useAttachments = (ticket) => {
  const can = useCan();
  const { showToast } = useToastStore();
  const store = useViewTicketStore();
  const { sendRequest } = useHttp();

  const attachments = store.ticket?.attachments ?? ticket.attachments ?? [];
  const [uploading, setUploading] = useState(false);

  const { ai } = useInitialPrefsStore();

  // Вложения заявки — её содержание: и добавить, и убрать может только тот,
  // кто ведёт заявки. Исполнитель и клиент прикладывают файлы в комментариях.
  const canUpload = !ticket.isArchived && can({ ticket: ["manage"] });
  const canDelete = !ticket.isArchived && can({ ticket: ["manage"] });
  const canTranscribe =
    !ticket.isArchived &&
    can({ ticket: ["perform"] }) &&
    ai?.speechToText?.isActive;

  const sync = (next) =>
    store.updateTicket({ ...store.ticket, attachments: next });

  const upload = (event) => {
    const files = [...(event.target.files ?? [])];
    if (!files.length) return;
    const formData = new FormData();
    for (const file of files) formData.append("attachments", file);
    setUploading(true);
    sendRequest(
      {
        url: `${import.meta.env.VITE_API_ADDRESS}/api/tickets/${ticket.num}/add-attachments`,
        method: "POST",
        isFormData: true,
        body: formData,
      },
      (data) => {
        setUploading(false);
        event.target.value = "";
        if (!data.success)
          return showToast("danger", "Не удалось загрузить файлы");
        sync([...attachments, ...(data.attachments ?? [])]);
        showToast(
          "success",
          `Добавлено файлов: ${data.attachments?.length ?? 0}`,
        );
      },
    );
  };

  const remove = (attachment) =>
    sendRequest(
      {
        url: `${import.meta.env.VITE_API_ADDRESS}/api/tickets/${ticket.num}/remove-attachment`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: { attachmentName: attachment.name },
      },
      (data) => {
        if (!data.success)
          return showToast("danger", "Не удалось удалить файл");
        sync(attachments.filter((item) => item.name !== attachment.name));
        showToast("success", "Файл удалён");
      },
    );

  // Действие секции живёт в её метке — и когда файлов нет, и когда их пять.
  // Скрытый input рендерится рядом с кнопкой: label по htmlFor открывает диалог
  // выбора, а сама кнопка остаётся кнопкой каталога
  const uploadAction = canUpload && (
    <>
      <input
        id="ticket-attachment-input"
        type="file"
        multiple
        className="hidden"
        onChange={upload}
      />
      <Button asChild variant="outline" size="xs" disabled={uploading}>
        <label htmlFor="ticket-attachment-input" className="cursor-pointer">
          <RiAttachment2 />
          {uploading ? "Загрузка…" : "Прикрепить"}
        </label>
      </Button>
    </>
  );

  return {
    attachments,
    uploadAction,
    remove,
    canDelete,
    canTranscribe,
    uploading,
    ticketNum: ticket.num,
  };
};

const AttachmentStrip = ({
  attachments,
  onRemove,
  canDelete,
  canTranscribe,
  ticketNum,
}) => {
  const { showToast } = useToastStore();
  const store = useViewTicketStore();

  const [preview, setPreview] = useState(null);
  const [openText, setOpenText] = useState("");
  const [busyName, setBusyName] = useState("");
  const [expanded, setExpanded] = useState(false);

  if (!attachments.length) return null;

  const audio = attachments.filter((item) => attachmentKind(item) === "audio");
  const files = attachments.filter((item) => attachmentKind(item) !== "audio");
  const shown = expanded ? files : files.slice(0, VISIBLE_LIMIT);

  const transcribe = async (attachment) => {
    setBusyName(attachment.name);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/tickets/${ticketNum}/attachments/speech-to-text`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ attachmentName: attachment.name }),
        },
      );
      const data = await response.json();
      if (data.attachments)
        store.updateTicket({ ...store.ticket, attachments: data.attachments });
      if (!response.ok || !data.success) {
        showToast("danger", data.message || "Не удалось распознать аудио");
        return;
      }
      showToast("success", "Аудио распознано");
      setOpenText(attachment.name);
    } catch (error) {
      console.error("Не удалось распознать аудио:", error);
      showToast("danger", "Не удалось распознать аудио");
    } finally {
      setBusyName("");
    }
  };

  return (
    <div className="mt-4 border-t border-border-soft pt-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs text-faint">
          <RiAttachment2 size={14} />
          {attachments.length}{" "}
          {attachments.length === 1
            ? "файл"
            : attachments.length < 5
              ? "файла"
              : "файлов"}
        </span>

        {shown.map((attachment) => (
          <AttachmentChip
            key={attachment.name}
            attachment={attachment}
            onOpen={
              attachmentKind(attachment) === "image" ? setPreview : undefined
            }
            onRemove={canDelete ? onRemove : undefined}
          />
        ))}

        {files.length > VISIBLE_LIMIT && !expanded && (
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="border-dashed text-muted-foreground"
            onClick={() => setExpanded(true)}
          >
            Показать все ({files.length})
          </Button>
        )}
      </div>

      {/* Запись звонка — во всю ширину: её слушают на месте, а не скачивают */}
      {audio.map((attachment) => {
        const speech = attachment.speechToText;
        return (
          <div key={attachment.name} className="mt-2">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1">
                <audio
                  controls
                  preload="none"
                  src={fileUrl(attachment.name)}
                  // Скачивание есть в чипе, а скорость воспроизведения записи
                  // звонка никому не нужна — «⋮»-меню плеера убираем целиком
                  controlsList="nodownload noplaybackrate"
                  disablePictureInPicture
                  className="h-9 w-full"
                />
              </span>

              {canTranscribe && (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={busyName === attachment.name}
                  onClick={() =>
                    speech?.status === "ready"
                      ? setOpenText(
                          openText === attachment.name ? "" : attachment.name,
                        )
                      : transcribe(attachment)
                  }
                >
                  {speech?.status === "ready" ? (
                    <RiFileTextLine />
                  ) : (
                    <RiVoiceprintLine />
                  )}
                  {busyName === attachment.name
                    ? "Распознаём…"
                    : speech?.status === "ready"
                      ? "Расшифровка"
                      : "Распознать"}
                </Button>
              )}

              {/* Скачивание — кнопкой, а не чипом с именем: имя записи звонка
                  («2026.07.16__79532148763__Odzjal Svetlana.mp3») занимает
                  полстроки и ничего не сообщает — файл и так подписан плеером */}
              <Button
                asChild
                variant="ghost"
                size="xs"
                title={attachmentName(attachment)}
              >
                <a
                  href={fileUrl(attachment.name)}
                  target="_blank"
                  rel="noreferrer"
                  download
                >
                  <RiDownloadLine /> Скачать
                </a>
              </Button>

              {canDelete && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  title="Удалить запись"
                  aria-label="Удалить запись"
                  className="text-faint hover:text-destructive"
                  onClick={() => onRemove(attachment)}
                >
                  <RiDeleteBinLine />
                </Button>
              )}
            </div>

            {/* Фоновое распознавание (звонок пришёл письмом) — иначе непонятно,
                почему расшифровки ещё нет */}
            {speech?.status === "pending" && (
              <p className="mt-1 mb-0 text-xs text-faint">
                ИИ распознаёт запись…
              </p>
            )}
            {speech?.status === "error" && (
              <p className="mt-1 mb-0 text-xs text-faint">
                Не удалось распознать
              </p>
            )}

            {/* Реплики разговора: speech.text — плоская расшифровка диалога.
                Пересказ звонка живёт только в описании заявки — второй его
                экземпляр здесь превращал одну мысль в три */}
            {openText === attachment.name && speech?.text && (
              <p className="mt-2 mb-0 border-s border-border ps-3 text-sm whitespace-pre-wrap text-muted-foreground">
                {speech.text}
              </p>
            )}
          </div>
        );
      })}

      <Dialog open={Boolean(preview)} onOpenChange={() => setPreview(null)}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="truncate">
              {attachmentName(preview)}
            </DialogTitle>
          </DialogHeader>
          {preview && (
            <img
              src={fileUrl(preview.name)}
              alt={attachmentName(preview)}
              className="max-h-[70dvh] w-full object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AttachmentStrip;
