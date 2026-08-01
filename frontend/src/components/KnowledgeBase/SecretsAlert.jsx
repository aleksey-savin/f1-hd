import { useState } from "react";

import { RiShieldKeyholeLine } from "react-icons/ri";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

import { plural } from "../../util/plural";

// Сколько находок показываем сразу: сканер на пёстрой заметке выдаёт десятки
// строк, и алерт превращается в стену раньше, чем модератор дочитает заголовок.
const VISIBLE = 5;

// Находки сканера учётных данных — только модератору. Сырой секрет не хранится:
// показываем замаскированный фрагмент. «Не секрет» запоминает хэш значения, а не
// текст, поэтому другой реальный секрет в той же заметке сработает снова.
const SecretsAlert = ({ note, isModerator, isLoading, onIgnore }) => {
  const [expanded, setExpanded] = useState(false);
  const findings = note?.secretsScan?.findings || [];

  if (!isModerator || !note?.secretsScan?.flagged || findings.length === 0) {
    return null;
  }

  const shown = expanded ? findings : findings.slice(0, VISIBLE);
  const hidden = findings.length - shown.length;

  return (
    <Alert
      variant="destructive"
      className="mt-4 border-destructive/30 bg-destructive/10"
    >
      <RiShieldKeyholeLine aria-hidden />
      <AlertTitle className="line-clamp-none">
        Возможные учётные данные — {findings.length}{" "}
        {plural(findings.length, "находка", "находки", "находок")}
      </AlertTitle>
      <AlertDescription className="mt-1.5 w-full">
        {/* Находки — плотным списком: одна строка на значение, действие
            появляется по наведению, чтобы 13 красных кнопок не забивали текст */}
        <div className="flex w-full flex-col">
          {shown.map((finding, index) => (
            <div
              key={finding.hash || index}
              className="group flex w-full items-center gap-3 py-1"
            >
              <span className="min-w-0 truncate font-mono text-sm text-foreground">
                {finding.maskedSnippet}
              </span>
              <Button
                size="xs"
                variant="ghost"
                disabled={isLoading}
                onClick={() => onIgnore(finding.hash)}
                className="ms-auto flex-none text-current opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
              >
                Не секрет
              </Button>
            </div>
          ))}
        </div>

        {(hidden > 0 || expanded) && (
          <Button
            size="xs"
            variant="ghost"
            className="mt-1 text-current"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "Свернуть" : `Показать все (${findings.length})`}
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
};

export default SecretsAlert;
