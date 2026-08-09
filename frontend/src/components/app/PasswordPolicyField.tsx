import { useEffect, useRef, useState } from "react";
import { RiCheckLine, RiFileCopyLine } from "react-icons/ri";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import PasswordInput, {
  adornmentButtonClass,
} from "@/components/app/PasswordInput";
import { cn } from "@/lib/utils";
import {
  GEN_DEFAULT,
  GEN_MAX,
  GEN_MIN,
  checkPassword,
  generatePassword,
  verdictAllows,
  verdictText,
  type PasswordVerdict,
} from "@/lib/password";

/**
 * Поле пароля с живой подсказкой и генератором.
 *
 * Подсказка говорит две правды: длину и сколько раз пароль встречается в
 * утечках. Чек-листа «заглавная / цифра / символ» нет намеренно — см.
 * `lib/password.ts`.
 *
 * Поля «повторите пароль» нет: его работу делает кнопка показа. Так же решено
 * в форме первого запуска.
 */
const DEBOUNCE_MS = 400;

type Props = {
  id: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  onVerdictChange?: (verdict: PasswordVerdict) => void;
  autoFocus?: boolean;
};

const PasswordPolicyField = ({
  id,
  label = "Новый пароль",
  value,
  onChange,
  onVerdictChange,
  autoFocus,
}: Props) => {
  const [verdict, setVerdict] = useState<PasswordVerdict>({ kind: "idle" });
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const [length, setLength] = useState(GEN_DEFAULT);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);

  useEffect(() => {
    onVerdictChange?.(verdict);
  }, [verdict, onVerdictChange]);

  useEffect(() => {
    if (!value) {
      setVerdict({ kind: "idle" });
      return;
    }
    // Короткий пароль виден по длине строки — за ним на сервер не ходим.
    if (value.length < 8) {
      setVerdict({ kind: "short", missing: 8 - value.length });
      return;
    }

    setVerdict({ kind: "checking" });
    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      const result = await checkPassword(value);
      // Ответ на устаревший запрос игнорируем: иначе быстрый набор оставит на
      // экране вердикт о предыдущем варианте.
      if (id === requestId.current) setVerdict(result);
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [value]);

  const generate = () => {
    onChange(generatePassword(length));
    // Сгенерированный пароль сразу показываем: его надо прочитать и передать.
    setShown(true);
    inputRef.current?.focus();
  };

  const copy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Буфер недоступен (нет https или отказано) — пароль виден на экране,
      // человек перепишет.
    }
  };

  const tone =
    verdict.kind === "breached"
      ? "text-destructive"
      : verdict.kind === "ok"
        ? "text-accent-text"
        : "text-muted-foreground";

  const dotTone =
    verdict.kind === "breached"
      ? "bg-destructive"
      : verdict.kind === "ok"
        ? "bg-accent-text"
        : verdict.kind === "checking"
          ? "bg-warning motion-safe:animate-pulse"
          : "bg-faint";

  return (
    <div className="flex flex-col gap-3.5">
      <div className="grid gap-1.5">
        <Label htmlFor={id} className="text-sm font-semibold text-muted-foreground">
          {label}
        </Label>
        <PasswordInput
          ref={inputRef}
          id={id}
          autoComplete="new-password"
          autoFocus={autoFocus}
          placeholder="Придумайте, вставьте или сгенерируйте"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          shown={shown}
          onShownChange={setShown}
          className={cn(shown && "font-mono tracking-tight")}
          extra={
            <button
              type="button"
              onClick={copy}
              disabled={!value}
              aria-label="Скопировать пароль"
              title="Скопировать"
              className={adornmentButtonClass}
            >
              {copied ? <RiCheckLine size={16} /> : <RiFileCopyLine size={16} />}
            </button>
          }
        />
      </div>

      <p className={cn("my-0 flex items-start gap-2 text-sm leading-snug", tone)}>
        <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", dotTone)} />
        <span>
          {verdict.kind === "breached" ? (
            <>
              Встречается в утечках{" "}
              <span className="font-semibold tabular-nums">
                {new Intl.NumberFormat("ru-RU").format(verdict.count)}
              </span>{" "}
              раз. Такой подбирают за секунды — возьмите другой.
            </>
          ) : (
            verdictText(verdict)
          )}
        </span>
      </p>

      <div className="flex flex-col gap-2.5 border-t border-border pt-3.5">
        <div className="flex items-center gap-3">
          <span className="shrink-0 text-[13px] font-semibold text-muted-foreground">
            Длина
          </span>
          <Slider
            value={[length]}
            onValueChange={([next]) => setLength(next)}
            min={GEN_MIN}
            max={GEN_MAX}
            step={1}
            aria-label="Длина пароля"
          />
          <span className="w-6 shrink-0 text-right text-[13px] font-semibold tabular-nums">
            {length}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-faint">
            Без похожих знаков — чтобы можно было продиктовать
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={generate}>
            Сгенерировать
          </Button>
        </div>
      </div>
    </div>
  );
};

export { PasswordPolicyField, verdictAllows };
export default PasswordPolicyField;
