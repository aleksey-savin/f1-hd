import { Fragment } from "react";

import { Eyebrow, Panel } from "@/components/app/Panel";
import { cn } from "@/lib/utils";
import {
  RISK_HEADLINE,
  commandsCount,
  firstRisky,
  resultLine,
  riskSentence,
} from "@/util/mikrotik-changes";

import ChangeNote from "./ChangeNote";
import FixCommand from "./FixCommand";

// Метка места, куда HD сам подставит значение (backend/services/mikrotik/changeRender.js)
const MARKER = "‹создаст HD›";
const OPEN = ["awaiting_requester", "awaiting_responsible"];

const RESULT_TEXT = {
  ok: "text-accent-text",
  bad: "text-destructive",
  idle: "text-muted-foreground",
};

// Команда в тёмном блоке: действие зелёным, подстановка HD приглушена
const Highlighted = ({ command }) => {
  const head = `${command.path} ${command.action}`;
  const matches = command.text.startsWith(head);
  const rest = matches ? command.text.slice(head.length) : command.text;
  const pieces = rest.split(MARKER);
  return (
    <>
      {matches && (
        <>
          {command.path}{" "}
          <em className="text-emerald-400 not-italic">{command.action}</em>
        </>
      )}
      {pieces.map((piece, index) => (
        <Fragment key={index}>
          {index > 0 && <i className="text-zinc-400 not-italic">{MARKER}</i>}
          {piece}
        </Fragment>
      ))}
    </>
  );
};

// «Было → станет» и строка, которую команда затрагивает. Секретов в `before`
// нет: сервер вырезает их при сборке запроса.
const DiffRows = ({ command }) => {
  const before = Object.entries(command.before || {}).filter(
    ([key]) => !key.startsWith("."),
  );
  if (!command.diff.length && !before.length) return null;
  return (
    <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground">
      {command.diff.map((row) => (
        <Fragment key={row.field}>
          <dt>{row.field}</dt>
          <dd className="m-0 min-w-0 wrap-anywhere">
            <code className="font-mono text-foreground line-through decoration-faint">
              {row.from || "—"}
            </code>{" "}
            → <code className="font-mono text-foreground">{row.to}</code>
          </dd>
        </Fragment>
      ))}
      {command.diff.length > 0 && before.length > 0 && (
        <>
          <dt>строка</dt>
          <dd className="m-0 min-w-0 wrap-anywhere">
            <code className="font-mono text-foreground">
              {before.map(([key, value]) => `${key}=${value}`).join(" ")}
            </code>
          </dd>
        </>
      )}
    </dl>
  );
};

// rollback === false — режим без safe mode: отката нет, обещать его нельзя
const ChangeCommands = ({ commands = [], status, risk, rollback }) => {
  const risky = risk === "high" ? firstRisky(commands) : null;
  const open = OPEN.includes(status);
  const hasMarker = commands.some((command) => command.text.includes(MARKER));

  return (
    <>
      <Eyebrow
        action={
          <span className="text-xs font-semibold tracking-wider text-faint uppercase">
            {commandsCount(commands.length)}, риск{" "}
            {risk === "high" ? "высокий" : "обычный"}
          </span>
        }
      >
        Команды
      </Eyebrow>
      <Panel>
        <div className="flex flex-col gap-3">
          {risky && (
            <ChangeNote title={RISK_HEADLINE}>
              {riskSentence(risky)}
              {rollback !== false &&
                " Если после применения HD не достучится до роутера, safe mode откатит изменения."}
            </ChangeNote>
          )}
          <ol className="m-0 flex list-none flex-col gap-3 p-0">
            {commands.map((command, index) => {
              const line = resultLine(command, status);
              return (
                <li
                  key={index}
                  className="grid grid-cols-[1.4rem_minmax(0,1fr)] gap-x-2"
                >
                  <span className="pt-2 text-right text-xs text-faint tabular-nums">
                    {index + 1}
                  </span>
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <FixCommand command={command.text}>
                      <Highlighted command={command} />
                    </FixCommand>
                    <DiffRows command={command} />
                    {line && (
                      <span
                        className={cn(
                          "flex flex-wrap items-baseline gap-1.5 text-xs",
                          RESULT_TEXT[line.tone],
                        )}
                      >
                        {line.text}
                        {line.code && (
                          <code className="font-mono wrap-anywhere">
                            {line.code}
                          </code>
                        )}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          {open && (
            <span className="text-sm text-muted-foreground">
              Команды собрал HD из запроса агента.
              {hasMarker &&
                " Ключи WireGuard HD создаст сам перед применением, агент их не увидит."}
            </span>
          )}
        </div>
      </Panel>
    </>
  );
};

export default ChangeCommands;
