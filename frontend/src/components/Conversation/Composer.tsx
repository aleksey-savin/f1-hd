import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { RiAttachment2, RiSendPlane2Line } from "react-icons/ri";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import useToastStore from "@/store/toast-store";
import {
  composerPlaceholder,
  phoneComposerHint,
} from "@/util/conversation-format";

import { failureText } from "./conversation-actions";

/**
 * Поле ответа внизу переписки (канва A1 — десктоп, B2 — телефон). Enter
 * отправляет, Shift+Enter — новая строка (на телефоне Enter — строка, как в
 * мессенджерах). «Ответ не нужен» — только пока диалог ждёт: снимает ожидание
 * без ответа, в ленте остаётся системная строка.
 */
const Composer = ({
  network,
  ticketNum,
  awaiting,
  phone = false,
  onSend,
  onHandled,
}: {
  network: string;
  ticketNum: number | null;
  awaiting: boolean;
  phone?: boolean;
  onSend: (draft: { text: string; files: File[] }) => Promise<unknown>;
  onHandled: () => Promise<unknown>;
}) => {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const inputId = phone ? "conversation-files-phone" : "conversation-files";
  const empty = !text.trim() && files.length === 0;

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (empty || sending) return;
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
        .showToast("danger", failureText(error, "Не удалось отправить сообщение"));
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (phone) return;
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  };

  const fileButton = (
    <>
      <input
        ref={fileInput}
        id={inputId}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => setFiles([...(event.target.files ?? [])])}
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
        className="flex-none border-t border-border-soft bg-card px-3 pt-2 pb-3"
      >
        <div className="mb-1.5 text-xs text-faint">
          {phoneComposerHint(network, ticketNum)}
        </div>
        <div className="flex items-end gap-2">
          {fileButton}
          <Textarea
            rows={1}
            value={text}
            placeholder="Сообщение"
            aria-label="Сообщение"
            onChange={(event) => setText(event.target.value)}
            className="max-h-32 min-h-11 resize-none rounded-lg py-2.5 text-base"
          />
          <Button
            type="submit"
            size="icon-lg"
            aria-label="Отправить"
            disabled={empty || sending}
          >
            <RiSendPlane2Line size={20} />
          </Button>
        </div>
        {awaiting && (
          <div className="mt-1.5 text-right">
            <Button type="button" variant="ghost" size="xs" onClick={() => void onHandled()}>
              Ответ не нужен
            </Button>
          </div>
        )}
      </form>
    );
  }

  return (
    <form onSubmit={submit} className="flex-none border-t border-border-soft px-4 py-3">
      <Textarea
        rows={2}
        value={text}
        placeholder={composerPlaceholder(network, ticketNum)}
        aria-label="Сообщение"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        className="max-h-40 resize-none rounded-lg bg-card"
      />
      <div className="mt-2 flex items-center gap-2">
        {fileButton}
        <span className="truncate text-xs whitespace-nowrap text-faint max-xl:hidden">
          Enter — отправить, Shift+Enter — новая строка
        </span>
        <span className="flex-1" />
        {awaiting && (
          <Button type="button" variant="ghost" size="xs" onClick={() => void onHandled()}>
            Ответ не нужен
          </Button>
        )}
        <Button
          type="submit"
          size="xs"
          disabled={empty || sending}
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
