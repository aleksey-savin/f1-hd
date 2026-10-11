import { useEffect, useState } from "react";
import {
  Link,
  useLoaderData,
  useLocation,
  useSearchParams,
} from "react-router";

import SearchBar from "@/components/app/SearchBar";
import Segmented from "@/components/app/Segmented";
import { useCrumbFrom } from "@/components/app/Crumbs";
import { Button } from "@/components/ui/button";
import { setDocTitle } from "@/hooks/use-doc-title";
import { useAuthedUser } from "@/store/authed-user";
import { articlePath, searchArticles, sectionAnchor } from "@/util/help";

const AUDIENCE_LABELS = { staff: "Сотрудникам", client: "Клиентам" };

export async function loader() {
  setDocTitle("Справка");
  const response = await fetch(`${import.meta.env.VITE_API_ADDRESS}/api/help`);
  if (!response.ok) throw response;
  return response;
}

// Пустое состояние по макету: без значка — на странице чтения он лишний
const Blank = ({ title, hint, children }) => (
  <div className="flex flex-col items-center gap-2.5 px-2 py-7 text-center">
    <div className="text-lg font-semibold">{title}</div>
    <p className="my-0 max-w-md text-sm text-muted-foreground">{hint}</p>
    {children}
  </div>
);

const HelpIndex = () => {
  const { audiences } = useLoaderData();
  const { isEndUser } = useAuthedUser();
  const { hash } = useLocation();
  const [params, setParams] = useSearchParams();
  const crumb = useCrumbFrom("Справка");

  const wanted = params.get("for");
  const audience =
    audiences.find((item) => item.key === wanted) ?? audiences[0];
  // Запрос — состояние страницы, а не адреса: смена параметров адреса
  // перезапускает загрузчик маршрута, и оглавление качалось бы на каждую букву
  const [query, setQuery] = useState("");
  const sections = audience?.sections ?? [];
  const found = searchArticles(sections, query);

  // Переход по крошке «Справка › Раздел»: подвести раздел под верх
  // Через кадр: на телефоне оболочка (layout/Root) в том же коммите сбрасывает
  // свой скролл наверх, и переход, сделанный сразу, она затёрла бы.
  useEffect(() => {
    if (!hash) return undefined;
    const frame = requestAnimationFrame(() => {
      document
        .getElementById(hash.slice(1))
        ?.scrollIntoView({ block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [hash, audience?.key]);

  const switchAudience = (value) => {
    setQuery("");
    setParams(value === audiences[0].key ? {} : { for: value }, {
      replace: true,
    });
  };

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="my-0 text-3xl leading-none font-semibold tracking-tight">
          Справка
        </h1>
        {audiences.length > 1 && (
          <Segmented
            fit
            ariaLabel="Чья справка"
            className="self-start"
            value={audience.key}
            onChange={switchAudience}
            options={audiences.map((item) => ({
              value: item.key,
              label: AUDIENCE_LABELS[item.key],
            }))}
          />
        )}
      </div>

      {!audience ? (
        <Blank
          title="Статей пока нет"
          hint={
            isEndUser
              ? "Справка пополняется. Если что-то непонятно, напишите нам в заявке."
              : "Справка пополняется."
          }
        >
          {isEndUser && (
            <Button asChild>
              <Link to="/dashboard/tickets/add" className="no-underline">
                Новая заявка
              </Link>
            </Button>
          )}
        </Blank>
      ) : (
        <>
          <SearchBar
            value={query}
            placeholder="Поиск по справке"
            ariaLabel="Поиск по справке"
            onChange={(event) => setQuery(event.target.value)}
          />

          {query.trim() ? (
            found.length ? (
              <ul className="m-0 flex list-none flex-col border-t border-rule p-0">
                {found.map((article) => (
                  <li
                    key={`${article.section.key}/${article.slug}`}
                    className="border-b border-border"
                  >
                    <Link
                      to={articlePath(
                        audience.key,
                        article.section.key,
                        article.slug,
                      )}
                      state={crumb}
                      className="flex flex-col gap-x-4 py-2 text-foreground no-underline hover:text-accent-text sm:flex-row sm:justify-between"
                    >
                      <span>{article.title}</span>
                      <span className="text-muted-foreground">
                        {article.section.title}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <Blank
                title="Ничего не нашлось"
                hint={`По запросу «${query.trim()}» статей нет. Попробуйте другое слово или вернитесь к оглавлению.`}
              >
                <Button variant="outline" onClick={() => setQuery("")}>
                  Сбросить
                </Button>
              </Blank>
            )
          ) : (
            <div className="flex flex-col gap-8 sm:block sm:columns-2 sm:gap-12">
              {sections.map((section) => (
                <section
                  key={section.key}
                  id={sectionAnchor(section.key)}
                  className="scroll-mt-28 break-inside-avoid border-t border-rule pt-3 sm:mb-8"
                >
                  <h2 className="my-0 flex items-baseline justify-between gap-2 text-base font-semibold">
                    {section.title}
                    <span className="text-xs font-medium text-faint tabular-nums">
                      {section.articles.length}
                    </span>
                  </h2>
                  <ul className="m-0 mt-1.5 flex list-none flex-col p-0">
                    {section.articles.map((article) => (
                      <li key={article.slug}>
                        <Link
                          to={articlePath(
                            audience.key,
                            section.key,
                            article.slug,
                          )}
                          state={crumb}
                          className="block py-1.5 text-foreground-soft no-underline hover:text-accent-text"
                        >
                          {article.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default HelpIndex;
