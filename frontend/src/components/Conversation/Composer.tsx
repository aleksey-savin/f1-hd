import {
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { RiAttachment2, RiCheckDoubleLine, RiCloseLine, RiSendPlane2Line } from "react-icons/ri";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import useToastStore from "@/store/toast-store";

import { failureText } from "./conversation-actions";
import StickerPicker from "./StickerPicker";
import DraftAttachments from "./DraftAttachments";

/**
 * Поле ответа внизу переписки (канва A1 — десктоп, B2 — телефон). Enter
 * отправляет, Shift+Enter — новая строка (на телефоне Enter — строка, как в
 * мессенджерах). «Ответ не нужен» — только пока диалог ждёт: снимает ожидание
 * без ответа, в ленте остаётся системная строка.
 */
const Composer = ({
  network,
  stickersAvailable = false,
  ticketNum: _ticketNum,
  awaiting,
  phone = false,
  sendBlocked = false,
  contextTitle,
  onChooseContext,
  replyTo,
  onCancelReply,
  onSend,
  onHandled,
}: {
  network: string;
  stickersAvailable?: boolean;
  ticketNum: number | null;
  awaiting: boolean;
  phone?: boolean;
  sendBlocked?: boolean;
  contextTitle?: string;
  onChooseContext?: () => void;
  replyTo?: { authorName: string; text: string } | null;
  onCancelReply?: () => void;
  onSend: (draft: {
    text: string;
    files: File[];
    stickerId?: string;
  }) => Promise<unknown>;
  onHandled: () => Promise<unknown>;
}) => {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const inputId = phone ? "conversation-files-phone" : "conversation-files";
  const empty = !text.trim() && files.length === 0;

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (empty || sendingRef.current || sendBlocked) return;
    sendingRef.current = true;
    setSending(true);
    try {
      await onSend({ text: text.trim(), files });
      setText("");
      setFiles([]);
      if (fileInput.current) fileInput.current.value = "";
    } catch (error) {
      // Текст остаётся в поле — повторить можно тем же нажатием
      useToastStore
        .getState()
        .showToast(
          "danger",
          failureText(error, "Не удалось отправить сообщение"),
        );
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const sendSticker = async (stickerId: string) => {
    if (sendingRef.current || sendBlocked)
      throw new Error("Отправка уже выполняется");
    sendingRef.current = true;
    setSending(true);
    try {
      await onSend({ text: "", files: [], stickerId });
    } catch (error) {
      useToastStore
        .getState()
        .showToast("danger", failureText(error, "Не удалось отправить стикер"));
      throw error;
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };
  const stickerButton =
    network === "telegram" && stickersAvailable ? (
      <StickerPicker
        onSend={sendSticker}
        disabled={sending || sendBlocked}
        phone={phone}
      />
    ) : null;

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (phone) return;
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      void submit();
    }
  };

  const addFiles = (incoming: File[]) =>
    setFiles((current) => [...current, ...incoming]);
  const pasteFiles = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!event.clipboardData.files.length) return;
    event.preventDefault();
    addFiles([...event.clipboardData.files]);
  };
  const dropFiles = (event: DragEvent<HTMLFormElement>) => {
    event.preventDefault();
    addFiles([...event.dataTransfer.files]);
  };
  const preview = (
    <DraftAttachments
      files={files}
      onRemove={(index) =>
        setFiles((current) => current.filter((_, i) => i !== index))
      }
    />
  );
  const quote = replyTo && (
    <div className="mb-2 flex items-start gap-2 border-l-2 border-primary px-2 text-xs">
      <div className="min-w-0 flex-1">
        <strong className="block text-accent-text">{replyTo.authorName}</strong>
        <span className="block truncate text-muted-foreground">
          {replyTo.text || "Вложение"}
        </span>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="Убрать цитату"
        onClick={onCancelReply}
      >
        <RiCloseLine />
      </Button>
    </div>
  );

  const fileButton = (
    <>
      <input
        ref={fileInput}
        id={inputId}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          addFiles([...(event.target.files ?? [])]);
          event.target.value = "";
        }}
      />
      {phone ? (
        <Button asChild variant="ghost" size="icon-lg" className="relative">
          <label htmlFor={inputId} aria-label="Файл" className="cursor-pointer">
            <RiAttachment2 size={20} />
            {files.length > 0 && (
              <span className="absolute top-0.5 right-0.5 inline-grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-xs leading-4 font-bold text-primary-foreground">
                {files.length}
              </span>
            )}
          </label>
        </Button>
      ) : (
        <Button asChild variant="outline" size="xs">
          <label htmlFor={inputId} className="cursor-pointer">
            <RiAttachment2 />
            {files.length > 0 ? `Файлов: ${files.length}` : "Файл"}
          </label>
        </Button>
      )}
    </>
  );

  if (phone) {
    return (
      <form
        onSubmit={submit}
        onDragOver={(event) => event.preventDefault()}
        onDrop={dropFiles}
        className="flex-none border-t border-border-soft bg-card px-3 pt-2 pb-3"
      >
        {contextTitle && onChooseContext && (
          <div className="mb-2 flex items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate font-semibold">
              {contextTitle}
            </span>
            <Button
              type="button"
              variant="link"
              size="xs"
              onClick={onChooseContext}
            >
              Изменить
            </Button>
          </div>
        )}
        {preview}
        {quote}
        <div className="flex items-end gap-2">
          {fileButton}
          {stickerButton}
          <Textarea
            rows={1}
            value={text}
            placeholder="Сообщение"
            aria-label="Сообщение"
            onChange={(event) => setText(event.target.value)}
            onPaste={pasteFiles}
            className="max-h-32 min-h-11 resize-none rounded-lg py-2.5 text-base"
          />
          <Button
            type="submit"
            size="icon-lg"
            aria-label="Отправить"
            disabled={empty || sending || sendBlocked}
          >
            <RiSendPlane2Line size={20} />
          </Button>
        </div>
        {awaiting && (
          <div className="mt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11 w-full bg-accent text-foreground"
              onClick={() => void onHandled()}
            >
              <RiCheckDoubleLine aria-hidden />
              Ответ не нужен
            </Button>
          </div>
        )}
      </form>
    );
  }

  return (
    <form
      onSubmit={submit}
      onDragOver={(event) => event.preventDefault()}
      onDrop={dropFiles}
      className="flex-none border-t border-border-soft px-4 py-3"
    >
      {quote}
      <Textarea
        rows={2}
        value={text}
        placeholder="Написать сообщение…"
        aria-label="Сообщение"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        onPaste={pasteFiles}
        className="max-h-40 resize-none rounded-lg bg-card"
      />
      {preview}
      <div className="mt-2 flex items-center gap-2">
        {fileButton}
        {stickerButton}
        <span className="truncate text-xs whitespace-nowrap text-faint max-xl:hidden">
          Enter — отправить, Shift+Enter — новая строка
        </span>
        <span className="flex-1" />
        {awaiting && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="bg-accent text-foreground pointer-coarse:min-h-11"
            onClick={() => void onHandled()}
          >
            <RiCheckDoubleLine aria-hidden />
            Ответ не нужен
          </Button>
        )}
        <Button
          type="submit"
          size="xs"
          disabled={empty || sending || sendBlocked}
          className={cn(sending && "cursor-wait")}
        >
          <RiSendPlane2Line />
          {sending ? "Отправка…" : "Отправить"}
        </Button>
      </div>
    </form>
  );
};

export default Composer;
