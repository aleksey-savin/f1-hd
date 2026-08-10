import { useState } from "react";

import {
  RiExternalLinkLine,
  RiRefreshLine,
  RiSparkling2Line,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import useViewTicketStore from "../../../store/view-ticket";
import useToastStore from "../../../store/toast-store";

// Понятийный аппарат заявки: что за предмет в ней вообще обсуждается.
//
// Справка отвечает на «что это такое», руководство — на «что делать по этой
// заявке». Поэтому справка живёт здесь, в описании: она про его текст. Своей
// секции у неё нет и в рейл она не попадает — рейл ведёт по разделам, а не по
// временным состояниям.
//
// Понятия делятся на два вида, и это главное в разметке: то, что человек
// написал сам, подчёркнуто прямо в описании; то, что ИИ добавил от себя, идёт
// строкой «Ещё в теме». Смешать их — значит потерять границу между словами
// заявителя и домыслом модели.

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Подчёркивает в готовом (уже очищенном) HTML описания те понятия, которые
 * встречаются в нём дословно. Обходим только текстовые куски, разрезая строку
 * по тегам, — иначе замена залезла бы внутрь атрибутов. В data-атрибут кладём
 * НОМЕР понятия, а не его текст: подставлять в разметку строку от модели незачем.
 *
 * @param {string} html очищенный DOMPurify html описания
 * @param {string[]} terms понятия, встречающиеся в тексте
 */
export const highlightTerms = (html, terms) => {
  const inText = (terms || []).filter(Boolean);
  if (!html || !inText.length) return html;

  // Длинные первыми: «Proxmox Backup Server» должен победить «Proxmox»
  const ordered = [...inText].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(${ordered.map(escapeRegExp).join("|")})`, "gi");

  return html
    .split(/(<[^>]+>)/)
    .map((chunk, index) => {
      if (index % 2 === 1) return chunk; // сам тег — не трогаем
      return chunk.replace(pattern, (match) => {
        const position = ordered.findIndex(
          (term) => term.toLowerCase() === match.toLowerCase(),
        );
        return `<span class="ai-term" role="button" tabindex="0" data-term="${position}">${match}</span>`;
      });
    })
    .join("");
};

// Иконка ИИ у нас одна на всё приложение — RiSparkling2Line. В готовый html
// React-узел не попадёт, поэтому здесь та же иконка, собранная как svg; путь
// скопирован из react-icons/ri (RiSparkling2Line). Не «похожая» и не глиф:
// метка обязана выглядеть одинаково у описания и у категории.
const SPARKLE_VIEWBOX = "0 0 24 24";
const SPARKLE_PATH =
  "M17.0007 1.20825 18.3195 3.68108 20.7923 4.99992 18.3195 6.31876 17.0007 8.79159 15.6818 6.31876 13.209 4.99992 15.6818 3.68108 17.0007 1.20825ZM10.6673 9.33325 15.6673 11.9999 10.6673 14.6666 8.00065 19.6666 5.33398 14.6666.333984 11.9999 5.33398 9.33325 8.00065 4.33325 10.6673 9.33325ZM11.4173 11.9999 9.18905 10.8115 8.00065 8.58325 6.81224 10.8115 4.58398 11.9999 6.81224 13.1883 8.00065 15.4166 9.18905 13.1883 11.4173 11.9999ZM19.6673 16.3333 18.0007 13.2083 16.334 16.3333 13.209 17.9999 16.334 19.6666 18.0007 22.7916 19.6673 19.6666 22.7923 17.9999 19.6673 16.3333Z";

/**
 * Дописывает метку ИИ в конец ПОСЛЕДНЕЙ СТРОКИ описания, а не отдельным блоком
 * под ним: метка относится к тексту, и с новой строки она читалась как кнопка
 * под панелью. Вставляем в DOM, а не строкой, — так метка попадает внутрь
 * последнего абзаца и остаётся в его строчном потоке. Значения кладём через
 * textContent/setAttribute: подставлять строки в разметку незачем.
 */
export const appendAiMark = (html, hint) => {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const SVG_NS = "http://www.w3.org/2000/svg";

  const mark = doc.createElement("span");
  mark.className = "ai-mark";
  mark.setAttribute("data-ai-mark", "1");
  mark.setAttribute("role", "button");
  mark.setAttribute("tabindex", "0");
  mark.setAttribute("title", `${hint} — нажмите, если что-то не так`);
  mark.setAttribute("aria-label", `${hint} — сообщить об ошибке`);

  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", SPARKLE_VIEWBOX);
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("aria-hidden", "true");

  const path = doc.createElementNS(SVG_NS, "path");
  path.setAttribute("d", SPARKLE_PATH);
  svg.append(path);
  // Клик приходит по svg — data-атрибут нужен и на нём, обработчик читает target
  svg.setAttribute("data-ai-mark", "1");
  mark.append(svg);

  // Пустые теги детей не носят: итог звонка приходит как «текст<br>текст», и
  // метка, положенная внутрь <br>, потерялась бы при сериализации. Ищем
  // последний тег, который может её принять; если такого нет — конец тела,
  // и метка всё равно окажется в строчном потоке.
  const VOID_TAGS = new Set([
    "BR",
    "IMG",
    "HR",
    "INPUT",
    "SOURCE",
    "AREA",
    "COL",
    "EMBED",
    "LINK",
    "META",
    "PARAM",
    "TRACK",
    "WBR",
  ]);
  let host = doc.body.lastElementChild;
  while (host && VOID_TAGS.has(host.tagName)) {
    host = host.previousElementSibling;
  }

  // Строчному содержимому не место прямо в списке или таблице — спускаемся к
  // последнему пункту, иначе метка встанет отдельной строкой мимо текста
  const NO_INLINE = new Set([
    "UL",
    "OL",
    "DL",
    "TABLE",
    "TBODY",
    "THEAD",
    "TFOOT",
    "TR",
  ]);
  while (host && NO_INLINE.has(host.tagName) && host.lastElementChild) {
    host = host.lastElementChild;
  }

  (host || doc.body).append(mark);

  return doc.body.innerHTML;
};

/** Порядок понятий для highlightTerms — тот же, что использует обработчик клика. */
export const inTextTerms = (ticket) =>
  (ticket?.aiTerms?.items || [])
    .filter((item) => item.inText)
    .map((item) => item.term)
    .sort((a, b) => b.length - a.length);

const Block = ({ block }) => {
  if (block.kind === "text") {
    return (
      <div>
        {block.title && (
          <h4 className="mb-1 text-sm font-semibold">{block.title}</h4>
        )}
        <p className="my-0 text-sm leading-relaxed">{block.text}</p>
      </div>
    );
  }

  const List = block.kind === "steps" ? "ol" : "ul";

  return (
    <div>
      {block.title && (
        <h4 className="mb-1 text-sm font-semibold">{block.title}</h4>
      )}
      <List
        className={cn(
          "my-0 flex flex-col gap-1 ps-5 text-sm leading-relaxed",
          block.kind === "steps" ? "list-decimal" : "list-disc",
        )}
      >
        {block.items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </List>
    </div>
  );
};

const Reference = ({ ticket, item, onClose, canSaveNote }) => {
  const [full, setFull] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const showToast = useToastStore((state) => state.showToast);
  const reference = item.reference || {};
  const blocks = reference.blocks || [];
  // Свёрнутая справка показывает начало: заголовок предмета и то, из чего он
  // состоит, обычно отвечают на вопрос целиком
  const visible = full ? blocks : blocks.slice(0, 2);

  const save = async () => {
    setSaving(true);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/tickets/ai-terms/save-note`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ _id: ticket._id, term: item.term }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message);

      setSaved(true);
      showToast("success", data.message);
    } catch (error) {
      showToast(
        "danger",
        error.message || "Не удалось сохранить справку — попробуйте ещё раз",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <article className="mt-3 overflow-hidden rounded-xl border border-primary/30 bg-primary/4">
      <div className="flex flex-wrap items-baseline gap-2 px-4 pt-3 pb-2">
        <h3 className="my-0 text-base font-semibold">{item.term}</h3>
        <span className="text-xs text-muted-foreground">справка ИИ</span>
      </div>

      <div className="flex flex-col gap-3.5 px-4 pb-1">
        {reference.summary && (
          <p className="my-0 text-sm leading-relaxed">{reference.summary}</p>
        )}
        {visible.map((block, index) => (
          <Block key={index} block={block} />
        ))}
        {!full && blocks.length > visible.length && (
          <button
            type="button"
            onClick={() => setFull(true)}
            className="cursor-pointer appearance-none self-start border-0 bg-transparent p-0 text-sm text-muted-foreground underline decoration-border underline-offset-4 outline-none hover:text-foreground"
          >
            Показать целиком
          </button>
        )}
      </div>

      {/* Документация — всегда на виду: справка пересказывает, а отвечает она.
          Ссылки прошли живую проверку на бэкенде: модель их охотно выдумывает */}
      {!!reference.links?.length && (
        <div className="mt-3 border-t border-border-soft px-4 pt-3">
          <h4 className="mb-2 text-xs font-semibold tracking-wide text-faint uppercase">
            Официальная документация
          </h4>
          <div className="flex flex-wrap gap-2">
            {reference.links.map((link) => (
              <a
                key={link.url}
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground no-underline hover:border-primary/30 hover:text-accent-text"
              >
                {link.title}
                <span className="text-faint">{link.host}</span>
                <RiExternalLinkLine size={12} aria-hidden />
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3 px-4 pt-3 pb-3.5">
        <span className="flex-1 text-xs text-muted-foreground">
          Ссылки и факты собрал ИИ — человеком не проверено.
        </span>
        {canSaveNote && (
          <Button size="xs" disabled={saving || saved} onClick={save}>
            {saved
              ? "Сохранено"
              : saving
                ? "Сохраняем…"
                : "Сохранить в базу знаний"}
          </Button>
        )}
        <Button variant="ghost" size="xs" onClick={onClose}>
          Свернуть
        </Button>
      </div>
    </article>
  );
};

/**
 * Строка понятий в подвале описания и раскрытая справка.
 *
 * @param {string|null} openTerm понятие, справка по которому раскрыта
 * @param {Function} onOpenTerm смена раскрытого понятия (null — свернуть)
 */
const TicketTerms = ({ openTerm, onOpenTerm, canSaveNote }) => {
  const ticket = useViewTicketStore((state) => state.ticket);
  const updateTicket = useViewTicketStore((state) => state.updateTicket);
  const [analyzing, setAnalyzing] = useState(false);
  const [busyTerm, setBusyTerm] = useState(null);
  const [error, setError] = useState(null);

  const terms = ticket.aiTerms || {};
  const items = terms.items || [];
  const status = terms.status || "idle";
  // Строкой показываем только то, чего в тексте нет: остальное подчёркнуто
  // прямо в описании
  const added = items.filter((item) => !item.inText);
  const open = items.find((item) => item.term === openTerm);

  const analyze = async () => {
    setAnalyzing(true);
    setError(null);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/tickets/ai-terms/analyze`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ _id: ticket._id }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message);

      onOpenTerm(null);
      updateTicket({
        ...useViewTicketStore.getState().ticket,
        aiTerms: data.aiTerms,
      });
    } catch (requestError) {
      setError(requestError.message || "Не удалось разобрать заявку");
    } finally {
      setAnalyzing(false);
    }
  };

  // Первое открытие стоит вызова модели, дальше справка лежит в заявке и
  // открывается чтением
  const openReference = async (item) => {
    if (item.term === openTerm) {
      onOpenTerm(null);
      return;
    }
    if (item.reference?.generatedAt) {
      onOpenTerm(item.term);
      return;
    }

    setBusyTerm(item.term);
    setError(null);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/tickets/ai-terms/reference`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ _id: ticket._id, term: item.term }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message);

      const current = useViewTicketStore.getState().ticket;
      updateTicket({
        ...current,
        aiTerms: {
          ...current.aiTerms,
          items: current.aiTerms.items.map((entry) =>
            entry.term === item.term ? { ...entry, ...data.item } : entry,
          ),
        },
      });
      onOpenTerm(item.term);
    } catch (requestError) {
      setError(requestError.message || "Не удалось составить справку");
    } finally {
      setBusyTerm(null);
    }
  };

  const chip = (item) => (
    <button
      key={item.term}
      type="button"
      disabled={busyTerm === item.term}
      onClick={() => openReference(item)}
      className={cn(
        "cursor-pointer appearance-none rounded-full border px-2.5 py-0.5 text-xs outline-none",
        item.term === openTerm
          ? "border-primary/40 bg-primary/8 text-accent-text"
          : "border-transparent bg-accent text-foreground hover:border-primary/30 hover:text-accent-text",
      )}
    >
      {busyTerm === item.term ? "Читаем…" : item.term}
    </button>
  );

  return (
    <>
      <div className="mt-2.5 flex flex-wrap items-center gap-2 text-sm">
        {status === "ready" && items.length ? (
          <>
            {!!added.length && (
              <span className="inline-flex items-center gap-1.5 text-xs text-faint">
                <RiSparkling2Line size={13} className="text-accent-text" />
                Ещё в теме
              </span>
            )}
            {added.map(chip)}
            <button
              type="button"
              disabled={analyzing}
              onClick={analyze}
              className="inline-flex cursor-pointer appearance-none items-center gap-1 border-0 bg-transparent p-0 text-xs text-muted-foreground outline-none hover:text-foreground"
            >
              <RiRefreshLine
                size={13}
                className={analyzing ? "animate-spin" : undefined}
              />
              разобрать заново
            </button>
          </>
        ) : (
          <>
            <span className="inline-flex items-center gap-1.5 text-xs text-faint">
              <RiSparkling2Line size={13} className="text-accent-text" />
              Понятия в заявке
            </span>
            <Button
              variant="outline"
              size="xs"
              disabled={analyzing}
              onClick={analyze}
            >
              {analyzing ? "Разбираем…" : "Разобрать"}
            </Button>
            <span className="text-xs text-faint">
              ИИ выделит предмет заявки и даст справку по нему
            </span>
          </>
        )}
      </div>

      {(error || (status === "error" && terms.error)) && (
        <p className="mt-1.5 mb-0 text-xs text-destructive">
          {error || terms.error}
        </p>
      )}
      {status === "ready" && !items.length && (
        <p className="mt-1.5 mb-0 text-xs text-muted-foreground">
          Предметных понятий в заявке не нашлось.
        </p>
      )}

      {open?.reference?.generatedAt && (
        <Reference
          ticket={ticket}
          item={open}
          canSaveNote={canSaveNote}
          onClose={() => onOpenTerm(null)}
        />
      )}
    </>
  );
};

export default TicketTerms;
