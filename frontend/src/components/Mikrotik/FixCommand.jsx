import { RiFileCopyLine } from "react-icons/ri";

import useToastStore from "@/store/toast-store";

// Команда для устройства с кнопкой «скопировать» — тёмный «терминал», как в
// инструкции по настройке (SetupHelp). Ошибки обновления и форма устройства.
// `children` — та же команда с подсветкой частей (запрос ИИ-агента): копируется
// всё равно `command`.
const FixCommand = ({ command, children }) => {
  const showToast = useToastStore((state) => state.showToast);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      showToast("success", "Команда скопирована");
    } catch {
      // буфер недоступен (небезопасный контекст) — команду выделяют руками
    }
  };

  return (
    <div className="flex items-start gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-2">
      <code className="min-w-0 flex-1 font-mono text-xs leading-relaxed break-all text-zinc-100">
        {children ?? command}
      </code>
      <button
        type="button"
        onClick={copy}
        title="Скопировать команду"
        aria-label="Скопировать команду"
        className="mt-0.5 flex-none cursor-pointer appearance-none border-0 bg-transparent p-0 text-zinc-500 transition-colors hover:text-zinc-200 max-md:-my-1.5 max-md:-me-1.5 max-md:grid max-md:size-8 max-md:place-items-center"
      >
        <RiFileCopyLine size={13} />
      </button>
    </div>
  );
};

export default FixCommand;
