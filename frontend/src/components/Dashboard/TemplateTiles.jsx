import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";

import { RiAddLine, RiFileList3Line } from "react-icons/ri";

import SearchBar from "@/components/app/SearchBar";
import { Eyebrow } from "@/components/app/Panel";
import { getLocalStorageData } from "../../util/auth";

/**
 * «Чем помочь?» — карточки шаблонов заявок плюс карточка свободного обращения.
 *
 * Герой клиентской главной. Шаблоны в системе были, а нажать на них было
 * негде: из 13 271 заявки по шаблону создано 13. Маршрут и предзаполнение
 * готовы давно (`/tickets/add?template=<id>` читает `pages/Ticket/Add.jsx`), не
 * хватало только места, где заготовку видно.
 *
 * Поиск появляется, когда карточек становится больше, чем удаётся окинуть
 * взглядом: до этого он лишний ряд управляющих элементов над двумя плитками.
 */

const SEARCH_FROM = 8;

// У шаблона нет поля иконки, а у одного из семи в базе пустой title — поэтому
// подпись и та берутся с запасным вариантом, а знак один на все карточки.
const templateTitle = (template) =>
  template.title?.trim() || template.categoryId?.title || "Без названия";

// heading = null — метки нет: у клиента её роль играет заголовок страницы
// («Чем помочь?»), и вторая такая же строка была бы эхом.
const TemplateTiles = ({ heading = null }) => {
  const [templates, setTemplates] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const load = async () => {
      const { token } = getLocalStorageData();
      try {
        const response = await fetch(
          `${import.meta.env.VITE_API_ADDRESS}/api/ticket-templates`,
          { headers: { Authorization: "Bearer " + token } },
        );
        if (!response.ok) throw new Error(`ticket-templates ${response.status}`);
        setTemplates(await response.json());
      } catch (error) {
        // Блок необязательный: не загрузился — остаётся одна карточка «Другой
        // вопрос», и человек всё равно может завести заявку.
        console.error("Не удалось загрузить шаблоны заявок:", error);
      } finally {
        setLoaded(true);
      }
    };
    load();
  }, []);

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return templates;
    return templates.filter((template) =>
      [templateTitle(template), template.categoryId?.title]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(term)),
    );
  }, [templates, query]);

  if (!loaded) return null;

  return (
    <section>
      {heading ? (
        <Eyebrow
          count={templates.length || undefined}
          action={
            templates.length >= SEARCH_FROM ? (
              <SearchBar
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Найти заготовку"
              />
            ) : undefined
          }
        >
          {heading}
        </Eyebrow>
      ) : (
        templates.length >= SEARCH_FROM && (
          <div className="tw:mb-2.5 tw:flex tw:justify-end">
            <SearchBar
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Найти заготовку"
            />
          </div>
        )
      )}

      <div className="tw:grid tw:grid-cols-2 tw:gap-3 tw:lg:grid-cols-4">
        {visible.map((template) => (
          <Link
            key={template._id}
            to={`/tickets/add?template=${template._id}`}
            className="tw:flex tw:flex-col tw:gap-2 tw:rounded-xl tw:border tw:border-border tw:bg-card tw:p-4 tw:text-foreground tw:no-underline tw:transition-colors tw:hover:border-primary tw:hover:bg-accent tw:hover:text-foreground"
          >
            <span className="tw:flex tw:size-9 tw:items-center tw:justify-center tw:rounded-lg tw:bg-accent tw:text-muted-foreground tw:inset-ring tw:inset-ring-border-soft">
              <RiFileList3Line size={17} aria-hidden />
            </span>
            <span className="tw:text-sm tw:font-semibold tw:leading-snug">
              {templateTitle(template)}
            </span>
            {template.categoryId?.title && (
              <span className="tw:text-xs tw:text-faint">
                {template.categoryId.title}
              </span>
            )}
          </Link>
        ))}

        {/* Свободное обращение — всегда последним и всегда на месте: заготовка
            подходит не каждому вопросу, и тупика тут быть не должно. */}
        <Link
          to="/tickets/add"
          className="tw:flex tw:flex-col tw:gap-2 tw:rounded-xl tw:border tw:border-dashed tw:border-border tw:bg-card tw:p-4 tw:text-foreground tw:no-underline tw:transition-colors tw:hover:border-primary tw:hover:bg-accent tw:hover:text-foreground"
        >
          <span className="tw:flex tw:size-9 tw:items-center tw:justify-center tw:rounded-lg tw:bg-accent tw:text-muted-foreground tw:inset-ring tw:inset-ring-border-soft">
            <RiAddLine size={17} aria-hidden />
          </span>
          <span className="tw:text-sm tw:font-semibold tw:leading-snug tw:text-muted-foreground">
            Другой вопрос
          </span>
          <span className="tw:text-xs tw:text-faint">Опишите своими словами</span>
        </Link>
      </div>

      {templates.length >= SEARCH_FROM && visible.length === 0 && (
        <div className="tw:mt-3 tw:text-sm tw:text-muted-foreground">
          Ничего не нашлось. Измените запрос или заведите заявку своими словами.
        </div>
      )}
    </section>
  );
};

export default TemplateTiles;
