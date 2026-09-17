import { useState } from "react";
import type { ReactNode } from "react";
import { RiCheckLine, RiFileCopyLine } from "react-icons/ri";

import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";

/**
 * Единственный показ выданного ключа — внутри DialogContent окна выдачи.
 *
 * ЗНАЧЕНИЕ ПОКАЗЫВАЕТСЯ ОДИН РАЗ: в базе лежит отпечаток, и прочитать выданный
 * ключ не может никто, включая администратора. Поэтому «Готово» заперто до
 * галочки «Я скопировал ключ» — та же, что у резервных кодов второго фактора, и
 * по той же причине: «Готово» без подтверждения нажимают не читая.
 *
 * Общий для API-ключей компании (Company/View/ApiKeysSection) и ключей
 * ИИ-агентов (Preferences/McpKeys). `children` — что вставить между ключом и
 * предупреждением: у агентов это готовый конфиг подключения.
 */
const IssuedKey = ({
  value,
  onDone,
  children,
}: {
  value: string;
  onDone: () => void;
  children?: ReactNode;
}) => {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  return (
    <>
      <div className="flex items-stretch overflow-hidden rounded-lg border border-border">
        <div className="min-w-0 flex-1 bg-accent/55 px-3 py-2.5 font-mono text-sm break-all">
          {value}
        </div>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
            } catch {
              // Буфер недоступен — ключ виден целиком и выделяется руками.
            }
          }}
          className="flex flex-none cursor-pointer appearance-none items-center gap-1.5 border-0 border-l border-border bg-card px-3.5 text-sm font-semibold text-accent-text"
        >
          {copied ? <RiCheckLine /> : <RiFileCopyLine />}
          {copied ? "Скопировано" : "Скопировать"}
        </button>
      </div>

      {children}

      <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm">
        Мы храним не сам ключ, а его отпечаток. Даже выгрузка базы не даст
        рабочего значения — но и восстановить его мы не сможем.
      </div>

      <label className="flex items-start gap-2.5 text-sm text-muted-foreground">
        <input
          type="checkbox"
          checked={saved}
          onChange={(event) => setSaved(event.target.checked)}
          className="mt-0.5 size-4"
        />
        Я скопировал ключ
      </label>

      <DialogFooter>
        <Button onClick={onDone} disabled={!saved}>
          Готово
        </Button>
      </DialogFooter>
    </>
  );
};

export default IssuedKey;
