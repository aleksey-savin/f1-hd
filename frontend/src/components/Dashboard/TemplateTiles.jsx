import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";

import { RiAddLine, RiFileList3Line } from "react-icons/ri";

import SearchBar from "@/components/app/SearchBar";
import { Eyebrow } from "@/components/app/Panel";

/**
 * «Чем помочь?» — карточки шаблонов заявок плюс карточка свободного обращения.
 *
 * Герой клиентской главной. Шаблоны в системе были, а нажать на них было
 * негде: из 13 271 заявки по шаблону создано 13. Маршрут и предзаполнение
 * готовы давно (`?template=<id>` читает `pages/Ticket/Add.jsx`), не хватало
 * только места, где заготовку видно. Форма — вложенный маршрут главной
 * (`/dashboard/tickets/add`): за шторкой остаётся главная, а не список заявок.
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
      try {
        const response = await fetch(
          `${import.meta.env.VITE_API_ADDRESS}/api/ticket-templates`,
        );
        if (!response.ok)
          throw new Error(`ticket-templates ${response.status}`);
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
          <div className="mb-2.5 flex justify-end">
            <SearchBar
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Найти заготовку"
            />
          </div>
        )
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {visible.map((template) => (
          <Link
            key={template._id}
            to={`/dashboard/tickets/add?template=${template._id}`}
            className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 text-foreground no-underline transition-colors hover:border-primary hover:bg-accent hover:text-foreground"
          >
            <span className="flex size-9 items-center justify-center rounded-lg bg-accent text-muted-foreground inset-ring inset-ring-border-soft">
              <RiFileList3Line size={17} aria-hidden />
            </span>
            <span className="text-sm font-semibold leading-snug">
              {templateTitle(template)}
            </span>
            {template.categoryId?.title && (
              <span className="text-xs text-faint">
                {template.categoryId.title}
              </span>
            )}
          </Link>
        ))}

        {/* Свободное обращение — всегда последним и всегда на месте: заготовка
            подходит не каждому вопросу, и тупика тут быть не должно. */}
        <Link
          to="/dashboard/tickets/add"
          className="flex flex-col gap-2 rounded-xl border border-dashed border-border bg-card p-4 text-foreground no-underline transition-colors hover:border-primary hover:bg-accent hover:text-foreground"
        >
          <span className="flex size-9 items-center justify-center rounded-lg bg-accent text-muted-foreground inset-ring inset-ring-border-soft">
            <RiAddLine size={17} aria-hidden />
          </span>
          <span className="text-sm font-semibold leading-snug text-muted-foreground">
            Другой вопрос
          </span>
          <span className="text-xs text-faint">Опишите своими словами</span>
        </Link>
      </div>

      {templates.length >= SEARCH_FROM && visible.length === 0 && (
        <div className="mt-3 text-sm text-muted-foreground">
          Ничего не нашлось. Измените запрос или заведите заявку своими словами.
        </div>
      )}
    </section>
  );
};

export default TemplateTiles;
