import { useMemo, useState } from "react";
import { Link } from "react-router";

import { RiAddLine, RiArrowDownSLine, RiArrowUpSLine } from "react-icons/ri";

import ChipMultiCombobox from "@/components/app/ChipMultiCombobox";
import SearchBar from "@/components/app/SearchBar";
import { Eyebrow } from "@/components/app/Panel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuthedUser } from "@/store/authed-user";
import useDashboardTemplatesStore from "@/store/dashboard-templates";
import { plural } from "../../util/plural";
import {
  templateCompanies,
  templateHasCompany,
} from "../../util/template-companies";

/**
 * «Чем помочь?» — карточки шаблонов заявок плюс карточка свободного обращения.
 *
 * Герой клиентской главной. Шаблоны в системе были, а нажать на них было
 * негде: из 13 271 заявки по шаблону создано 13. Маршрут и предзаполнение
 * готовы давно (`?template=<id>` читает `pages/Ticket/Add.jsx`), не хватало
 * только места, где шаблон видно. Форма — вложенный маршрут главной
 * (`/dashboard/tickets/add`): за шторкой остаётся главная, а не список заявок.
 *
 * Блок — ряд из ЧЕТЫРЁХ карточек, и четвёртая всегда одна и та же: свободное
 * обращение. Шаблонов будет много (каталог категорий — три десятка), поэтому
 * лендинг показывает три и отдаёт остальные под «Показать все N»: блок отвечает
 * на «с чего начать», а не показывает справочник.
 *
 * Карточка не рассказывает про внутренности шаблона (сколько вопросов, есть ли
 * чек-лист) — это видно в форме, куда карточка и ведёт. Плитки-глифа нет: одна
 * и та же иконка на всех карточках их не различает (гайд, «Плитка слева —
 * только когда она различает строки»). Осталась она у свободного обращения — та
 * карточка другого рода, и пунктир говорит о том же.
 *
 * На телефоне ряд — список в одну колонку: карточка становится строкой с одной
 * метой «категория · доступ», а из строки инструментов остаётся поиск — сетка
 * 2×2 в 360 px обрезала названия до полутора слов, а поиск с двумя фасетами
 * ставил два ряда контролов над заявками.
 */

// Сколько шаблонов в ряду до «Показать все»: четвёртая карточка — свободное
// обращение, и место у неё постоянное.
const PREVIEW = 3;

// С этого числа шаблонов появляется строка инструментов. Меньше — ряд
// охватывается взглядом, и поиск с фасетами был бы лишним рядом над двумя
// карточками.
const TOOLS_FROM = 8;

// У шаблона нет поля иконки, а у одного из восьми в базе пустой title — поэтому
// подпись берётся с запасным вариантом.
const templateTitle = (template) =>
  template.title?.trim() || template.categoryId?.title || "Без названия";

const sharedWith = (template) => [
  ...(template.sharedCompanies ?? []),
  ...(template.sharedUsers ?? []),
];

const isShared = (template) =>
  !!template.allowAllStaff || sharedWith(template).length > 0;

/**
 * Кому роздан шаблон — тем же языком, что строка списка шаблонов
 * (`TicketTemplate/Item`): «Всем сотрудникам» · «ООО «Ромашка» +2» · «Личный».
 * Клиенту эта строка не показывается: у него один адресат — он сам.
 */
const accessLabel = (template) => {
  if (template.allowAllStaff) return "Всем сотрудникам";
  const targets = sharedWith(template);
  if (targets.length === 0) return "Личный";
  const first =
    targets[0].alias ??
    `${targets[0].lastName ?? ""} ${targets[0].firstName ?? ""}`.trim();
  return targets.length > 1 ? `${first} +${targets.length - 1}` : first;
};

const optionsOf = (entries) => {
  const seen = new Map();
  for (const entry of entries) {
    const value = entry?._id ? String(entry._id) : "";
    const label = entry?.alias ?? entry?.title ?? "";
    if (value && label && !seen.has(value)) seen.set(value, { value, label });
  }
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
};

const CARD =
  "flex flex-col gap-0.5 rounded-xl border border-border bg-card px-4 py-2 text-foreground no-underline transition-colors hover:border-primary hover:bg-accent hover:text-foreground md:px-3.5 md:py-2.5";

const TemplateCard = ({ template, showAccess }) => {
  const shared = isShared(template);
  // Телефон: карточка — строка списка, категория и доступ одной метой
  const phoneMeta = [
    template.categoryId?.title,
    showAccess ? accessLabel(template) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Link
      to={`/dashboard/tickets/add?template=${template._id}`}
      className={CARD}
    >
      <span className="truncate text-sm font-semibold">
        {templateTitle(template)}
      </span>
      {phoneMeta && (
        <span className="flex items-center gap-1.5 text-xs text-faint md:hidden">
          {showAccess && (
            <span
              aria-hidden
              className={cn(
                "size-1.5 flex-none rounded-full",
                shared ? "bg-primary" : "bg-faint",
              )}
            />
          )}
          <span className="truncate">{phoneMeta}</span>
        </span>
      )}
      {template.categoryId?.title && (
        <span className="truncate text-xs text-faint max-md:hidden">
          {template.categoryId.title}
        </span>
      )}
      {showAccess && (
        <span
          className={cn(
            "mt-1 flex items-center gap-1.5 text-xs max-md:hidden",
            shared ? "text-accent-text" : "text-faint",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "size-1.5 flex-none rounded-full",
              shared ? "bg-primary" : "bg-faint",
            )}
          />
          <span className="truncate">{accessLabel(template)}</span>
        </span>
      )}
    </Link>
  );
};

/**
 * Свободное обращение — всегда последним и всегда на месте: шаблон подходит не
 * каждому вопросу, и тупика тут быть не должно.
 *
 * Когда шаблонов нет вовсе, карточка называется «Создать заявку»: «другой
 * вопрос» не от чего отличать, и на две колонки — одна четверть под большим
 * заголовком читается как остаток от пропавшего ряда.
 */
const FreeCard = ({ alone }) => (
  <Link
    to="/dashboard/tickets/add"
    className={cn(CARD, "border-dashed", alone && "md:col-span-2")}
  >
    <span className="flex items-center gap-2">
      <span className="flex size-6 flex-none items-center justify-center rounded-md bg-accent text-muted-foreground inset-ring inset-ring-border-soft">
        <RiAddLine size={14} aria-hidden />
      </span>
      <span className="truncate text-sm font-semibold text-muted-foreground">
        {alone ? "Создать заявку" : "Другой вопрос"}
      </span>
    </span>
    <span className="truncate text-xs text-faint">Опишите своими словами</span>
  </Link>
);

// heading = null — метки нет: у клиента её роль играет заголовок страницы
// («Чем помочь?»), и вторая такая же строка была бы эхом.
const TemplateTiles = ({ heading = null, className }) => {
  const { isEndUser } = useAuthedUser();
  const templates = useDashboardTemplatesStore((state) => state.templates);
  const loaded = useDashboardTemplatesStore((state) => state.loaded);

  const [query, setQuery] = useState("");
  const [companies, setCompanies] = useState([]);
  const [categories, setCategories] = useState([]);
  const [expanded, setExpanded] = useState(false);

  const companyOptions = useMemo(
    () => optionsOf(templates.flatMap(templateCompanies)),
    [templates],
  );
  const categoryOptions = useMemo(
    () => optionsOf(templates.map((template) => template.categoryId)),
    [templates],
  );

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return templates.filter((template) => {
      if (companies.length && !templateHasCompany(template, companies)) {
        return false;
      }
      if (
        categories.length &&
        !categories.includes(String(template.categoryId?._id ?? ""))
      ) {
        return false;
      }
      if (!term) return true;
      return [templateTitle(template), template.categoryId?.title]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(term));
    });
  }, [templates, query, companies, categories]);

  if (!loaded) return null;

  // Шаблонов нет вовсе. У клиента блок всё равно нужен — это его единственный
  // вход в заявку; у сотрудника метка «Шаблоны заявок» над одной чужой
  // карточкой обещала бы то, чего нет (гайд: пустой блок не рисуется вовсе).
  const empty = templates.length === 0;
  if (empty && !isEndUser) return null;

  const shown = expanded ? visible : visible.slice(0, PREVIEW);
  const dirty = !!query.trim() || companies.length > 0 || categories.length > 0;

  // Фасет, который ничего не сужает, места не занимает: у клиента компания
  // одна, а категория часто одна на весь его набор.
  const showTools = templates.length >= TOOLS_FROM;
  const showCompanies = !isEndUser && companyOptions.length > 1;
  const showCategories = categoryOptions.length > 1;

  const reset = () => {
    setQuery("");
    setCompanies([]);
    setCategories([]);
  };

  return (
    <section className={className}>
      {heading && (
        <Eyebrow count={templates.length || undefined}>{heading}</Eyebrow>
      )}

      {showTools && (
        <div className="mb-2.5 flex flex-wrap items-center gap-2.5">
          <SearchBar
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск по шаблонам…"
            className="w-full sm:w-80"
          />
          {/* Фасеты — только с md: на телефоне остаётся поиск (он ищет и по
              категории), два чипа под ним ставили второй ряд контролов */}
          {showCompanies && (
            <ChipMultiCombobox
              placeholder="Компания"
              searchPlaceholder="Найти компанию"
              countLabel={(n) =>
                `${n} ${plural(n, "компания", "компании", "компаний")}`
              }
              value={companies}
              options={companyOptions}
              onChange={setCompanies}
              className="max-md:hidden"
            />
          )}
          {showCategories && (
            <ChipMultiCombobox
              placeholder="Категория"
              searchPlaceholder="Найти категорию"
              countLabel={(n) =>
                `${n} ${plural(n, "категория", "категории", "категорий")}`
              }
              value={categories}
              options={categoryOptions}
              onChange={setCategories}
              className="max-md:hidden"
            />
          )}
          {dirty && (
            <Button variant="ghost" onClick={reset}>
              Сбросить
            </Button>
          )}
        </div>
      )}

      <div className="grid gap-2 md:grid-cols-2 md:gap-3 lg:grid-cols-4">
        {shown.map((template) => (
          <TemplateCard
            key={template._id}
            template={template}
            showAccess={!isEndUser}
          />
        ))}
        <FreeCard alone={empty} />
      </div>

      {visible.length === 0 && !empty && (
        <div className="mt-3 text-sm text-muted-foreground">
          Ничего не нашлось. Измените запрос или{" "}
          <Button
            variant="link"
            className="h-auto p-0 text-sm font-semibold"
            onClick={reset}
          >
            сбросьте фильтры
          </Button>
          .
        </div>
      )}

      {/* Кнопка живёт по НАБОРУ, а не по состоянию раскрытия: отфильтровав
          раскрытый блок до трёх карточек, человек видит их все, и «Свернуть»
          сворачивать было бы нечего */}
      {visible.length > PREVIEW && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-1.5 text-accent-text"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Свернуть" : `Показать все ${visible.length}`}
          {expanded ? <RiArrowUpSLine /> : <RiArrowDownSLine />}
        </Button>
      )}
    </section>
  );
};

export default TemplateTiles;
