import { useEffect, useState } from "react";

import {
  RiArrowDownSLine,
  RiCheckLine,
  RiFileCopyLine,
  RiRefreshLine,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

// "22000 22111, 22222" -> [22000, 22111, 22222]
export const parseKnock = (value) =>
  String(value || "")
    .split(/[\s,]+/)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0 && n < 65536);

// A strong random password (crypto RNG) from an unambiguous, RouterOS-quote-safe
// alphabet (no " \ $ ` and no 0/O/1/l/I lookalikes).
export const genPassword = () => {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#%*-_=+";
  const bytes = new Uint32Array(20);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (n) => alphabet[n % alphabet.length]).join("");
};

// Least-privilege group policy for the managed user (never full/policy/sensitive).
const MANAGED_POLICY = "api,read,test,ssh";

// Three distinct random high ports (20000–39999) for the knock sequence.
const genKnockPorts = () => {
  const ports = new Set();
  while (ports.size < 3) ports.add(20000 + Math.floor(Math.random() * 20000));
  return [...ports];
};

// Builds the copy-pastable RouterOS setup script from the chosen presets, filling
// in the values from the form so device config and app config always match. Each
// command is a full-path one-liner so it can be copied and run line by line.
const buildSetupCommands = ({
  presets,
  host,
  user,
  password,
  apiPort,
  sshPort,
  knockPorts,
}) => {
  const commonName = host?.trim() || "<имя-устройства>";
  const login = user?.trim() || "<логин>";
  const pass = password?.trim() || "<пароль>";
  const api = String(apiPort || "8729").trim();
  const ssh = String(sshPort || "22").trim();
  const [p1, p2, p3] =
    knockPorts.length === 3 ? knockPorts : ["<П1>", "<П2>", "<П3>"];

  const blocks = [];

  if (presets.user) {
    blocks.push(
      `# Пользователь с минимальными правами (без full/policy/sensitive)
/user group add name=hd-mgmt policy=${MANAGED_POLICY}
/user add name=${login} group=hd-mgmt password="${pass}"`,
    );
  }

  if (presets.cert) {
    blocks.push(
      `# Самоподписанный сертификат (key-cert-sign+crl-sign → подпись без внешнего CA), API-SSL вкл, плейнтекст-API выкл
/certificate add name=hd-api common-name=${commonName} key-usage=digital-signature,key-encipherment,key-cert-sign,crl-sign,tls-server days-valid=3650 key-size=2048
/certificate sign hd-api
/ip service set api-ssl certificate=hd-api disabled=no
/ip service set api disabled=yes`,
    );
  }

  if (presets.knock) {
    const lines = [
      `# Port knocking — правила вставляются В НАЧАЛО цепочки input (place-before),
# чтобы стоять выше блокирующего правила. Стук ${p1} -> ${p2} -> ${p3} открывает
# ${api} (API-SSL) и ${ssh} (SSH) источнику на 8 часов. Якорь — через :global
# (:local не переживает построчную вставку в терминал).`,
      `:global hdTop [:pick [/ip firewall filter find chain=input] 0]`,
      `/ip firewall filter add chain=input action=add-src-to-address-list address-list=hd-knock1 address-list-timeout=15s protocol=tcp dst-port=${p1} comment="hd knock 1" place-before=$hdTop`,
      `/ip firewall filter add chain=input action=add-src-to-address-list address-list=hd-knock2 address-list-timeout=15s protocol=tcp dst-port=${p2} src-address-list=hd-knock1 comment="hd knock 2" place-before=$hdTop`,
      `/ip firewall filter add chain=input action=add-src-to-address-list address-list=hd-allowed address-list-timeout=8h protocol=tcp dst-port=${p3} src-address-list=hd-knock2 comment="hd knock 3" place-before=$hdTop`,
      `/ip firewall filter add chain=input action=accept protocol=tcp dst-port=${api},${ssh} src-address-list=hd-allowed comment="hd allow admin" place-before=$hdTop`,
    ];
    if (presets.drop) {
      lines.push(
        `# Закрыть admin-порты из WAN. connection-state=new не рвёт established-сессии;
# нужен interface-list WAN (в стоковом конфиге есть) — иначе укажите свой WAN.`,
        `/ip firewall filter add chain=input action=drop protocol=tcp dst-port=${api},${ssh} connection-state=new in-interface-list=WAN comment="hd drop admin (WAN)" place-before=$hdTop`,
      );
    }
    blocks.push(lines.join("\n"));
  }

  return blocks.join("\n\n") || "# Выберите хотя бы один пункт";
};

const PRESETS = [
  { key: "user", label: "Пользователь" },
  { key: "cert", label: "Сертификат + API-SSL" },
  { key: "knock", label: "Port knocking" },
  { key: "drop", label: "Закрыть admin-порты из WAN" },
];

// Разворачиваемая инструкция по настройке устройства: чекбоксы-пресеты
// (пользователь / сертификат / port knocking / drop из WAN) собирают готовые
// RouterOS-команды из значений формы; knock-порты генерируются и пишутся
// обратно в поле формы, так что конфиг устройства и приложения совпадают.
// Код-блок — «терминал», тёмный в обеих темах, копируется построчно и целиком.
const SetupHelp = ({
  host,
  user,
  password,
  apiPort,
  sshPort,
  knockSequence,
  onChange,
  jumpSelected = false,
}) => {
  const [open, setOpen] = useState(false);
  // Пометки «уже скопировано» — постоянные (прогресс переноса команд в
  // терминал) и по ТЕКСТУ строки, не по индексу: команды пересобираются из
  // полей формы, и изменившаяся строка (новый пароль, другие порты) сама
  // теряет пометку — устаревшее «скопировано» не врёт.
  const [copiedLines, setCopiedLines] = useState(() => new Set());
  const [presets, setPresets] = useState({
    user: true,
    cert: true,
    knock: true,
    drop: false,
  });

  const knockPorts = parseKnock(knockSequence).slice(0, 3);

  // Через транзит knock не используется — его пресеты выключаются и не
  // предлагаются в скрипте (доступ ограничивается файрволом устройства).
  const effectivePresets = jumpSelected
    ? { ...presets, knock: false, drop: false }
    : presets;

  // Generate random knock ports and push them into the form field.
  const generatePorts = () => {
    onChange?.({
      target: { name: "knockSequence", value: genKnockPorts().join(" ") },
    });
  };

  // Auto-fill knock ports when opening the block with knocking enabled and no
  // usable sequence yet — never clobbers a complete one the user already typed.
  useEffect(() => {
    if (
      open &&
      presets.knock &&
      !jumpSelected &&
      parseKnock(knockSequence).length < 3
    ) {
      generatePorts();
    }
  }, [open, presets.knock, jumpSelected]);

  const commands = buildSetupCommands({
    presets: effectivePresets,
    host,
    user,
    password,
    apiPort,
    sshPort,
    knockPorts,
  });

  const isComment = (line) => line.trimStart().startsWith("#");
  const isCommandLine = (line) => line.trim() !== "" && !isComment(line);
  const commandLines = commands.split("\n");

  const markCopied = (lines) =>
    setCopiedLines((prev) => {
      const next = new Set(prev);
      for (const line of lines) next.add(line);
      return next;
    });

  const copyLine = async (line) => {
    try {
      await navigator.clipboard.writeText(line);
      markCopied([line]);
    } catch {
      // clipboard unavailable (non-secure context) — user can select manually
    }
  };

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(commands);
      markCopied(commandLines.filter(isCommandLine));
    } catch {
      // clipboard unavailable (non-secure context) — user can select manually
    }
  };

  const commandOnly = commandLines.filter(isCommandLine);
  const allCopied =
    commandOnly.length > 0 &&
    commandOnly.every((line) => copiedLines.has(line));

  const togglePreset = (key) =>
    setPresets((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className="mt-1 rounded-xl border border-dashed border-border px-4 py-3">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="flex w-full cursor-pointer appearance-none items-center gap-3 border-0 bg-transparent p-0 text-left text-foreground"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">
            Инструкция по настройке устройства
          </span>
          <span className="block text-xs text-faint">
            Готовые команды RouterOS: пользователь, сертификат для API-SSL, port
            knocking.
          </span>
        </span>
        <RiArrowDownSLine
          aria-hidden
          className={cn(
            "flex-none text-faint transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="mt-3">
          <div className="mb-3 flex flex-wrap gap-x-4 gap-y-2">
            {PRESETS.map((preset) => {
              const disabled =
                jumpSelected &&
                (preset.key === "knock" || preset.key === "drop")
                  ? true
                  : preset.key === "drop" && !effectivePresets.knock;
              return (
                <label
                  key={preset.key}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 text-sm",
                    disabled && "cursor-not-allowed opacity-50",
                  )}
                >
                  <Checkbox
                    checked={effectivePresets[preset.key]}
                    disabled={disabled}
                    onCheckedChange={() => togglePreset(preset.key)}
                  />
                  {preset.label}
                </label>
              );
            })}
          </div>

          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-bold tracking-wider text-faint uppercase">
              RouterOS
            </span>
            <div className="flex gap-1.5">
              {effectivePresets.knock && (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={generatePorts}
                  title="Сгенерировать другие порты"
                >
                  <RiRefreshLine /> Порты
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={copyAll}
                title="Скопировать все команды"
              >
                {allCopied ? <RiCheckLine /> : <RiFileCopyLine />} Всё
              </Button>
            </div>
          </div>

          {/* «Терминал» — тёмный в обеих темах */}
          <div className="max-h-96 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 p-2.5">
            {commandLines.map((line, i) => {
              // Скопированная команда остаётся подсвеченной — видно, что уже
              // перенесено в терминал, а что ещё нет.
              const copied = isCommandLine(line) && copiedLines.has(line);
              return line.trim() === "" ? (
                <div key={i} className="h-2" />
              ) : (
                <div key={i} className="flex items-start gap-2">
                  <code
                    className={cn(
                      "min-w-0 flex-1 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap transition-colors duration-300",
                      isComment(line)
                        ? "text-zinc-500"
                        : copied
                          ? "text-primary"
                          : "text-zinc-100",
                    )}
                  >
                    {line}
                  </code>
                  {!isComment(line) && (
                    <button
                      type="button"
                      onClick={() => copyLine(line)}
                      title="Скопировать строку"
                      className={cn(
                        "mt-0.5 flex-none cursor-pointer appearance-none border-0 bg-transparent p-0 transition-colors",
                        copied
                          ? "text-primary"
                          : "text-zinc-500 hover:text-zinc-200",
                      )}
                    >
                      {copied ? (
                        <RiCheckLine size={13} />
                      ) : (
                        <RiFileCopyLine size={13} />
                      )}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-1.5 text-xs text-faint">
            Логин, пароль и порты подставлены из формы — knock-порты уже в поле
            Port knocking выше. Сертификат самоподписанный (TOFU),{" "}
            <code className="font-mono">/certificate sign</code> занимает
            ~минуту.
          </div>
        </div>
      )}
    </div>
  );
};

export default SetupHelp;
