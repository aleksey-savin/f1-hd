import { useCallback, useEffect, useState } from "react";
import { Link, useLoaderData } from "react-router";
import { BrowserView } from "react-device-detect";

import AnchorRail from "@/components/app/AnchorRail";
import Crumbs from "@/components/app/Crumbs";
import { Button } from "@/components/ui/button";
import { setDocTitle } from "@/hooks/use-doc-title";
import { useAuthedUser, useCan } from "@/store/authed-user";
import useToastStore from "@/store/toast-store";
import {
  articlePath,
  formatUpdated,
  indexPath,
  railSections,
  resolveImages,
} from "@/util/help";
import { sectionForPath } from "@/util/sections";

import MarkdownViewer from "../../UI/MarkdownViewer";

export async function loader({ params }) {
  const { audience, section, slug } = params;
  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/help/${audience}/${section}/${slug}`,
  );
  if (!response.ok) throw response;
  const article = await response.json();
  setDocTitle(article.title);
  return article;
}

const HelpArticle = () => {
  const article = useLoaderData();
  const { isEndUser } = useAuthedUser();
  const can = useCan();
  const [rail, setRail] = useState([]);
  const showToast = useToastStore((state) => state.showToast);

  const { audience, section } = article;

  // Кнопка перехода в портал — только тому, кому целевой раздел открыт:
  // статью об «Интеграциях» читает и сотрудник без права на настройки, и
  // кнопка привела бы его к отказу в доступе
  const target = article.link
    ? sectionForPath(article.link.split(/[?#]/)[0])
    : undefined;
  const linkOpen = Boolean(article.link) && (!target?.can || can(target.can));

  // Окно не сбрасывает прокрутку при переходе, а компонент между статьями
  // переиспользуется: без этого следующая статья открывалась бы с того места,
  // где дочитали предыдущую (телефон сбрасывает сам — layout/Root).
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [audience, section.key, article.slug]);
  const body = resolveImages(
    article.body,
    `${import.meta.env.VITE_API_ADDRESS}/api/help/${audience}/${section.key}`,
  );

  // Toast UI якорей заголовкам не ставит: проставляем сами и собираем рейку
  const onRendered = useCallback((element) => {
    const headings = [...element.querySelectorAll("h2")];
    const sections = railSections(headings.map((h) => h.textContent.trim()));
    sections.forEach((item, index) => {
      headings[index].id = item.id;
    });
    setRail(sections);
  }, []);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      showToast("success", "Ссылка скопирована");
    } catch {
      showToast("danger", "Не удалось скопировать ссылку");
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <Crumbs
        section="help"
        chain={[
          {
            label: section.title,
            to: indexPath(audience, isEndUser, section.key),
          },
        ]}
      />

      {!isEndUser && audience === "client" && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-muted px-3 py-2 text-muted-foreground">
          <span>Статья для клиентов</span>
          <button
            type="button"
            onClick={copyLink}
            className="cursor-pointer border-0 bg-transparent p-0 text-inherit underline decoration-border underline-offset-4"
          >
            Скопировать ссылку
          </button>
        </div>
      )}

      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="my-0 text-2xl font-semibold tracking-tight text-balance">
            {article.title}
          </h1>
          <p className="my-0 max-w-prose text-base leading-relaxed text-muted-foreground">
            {article.summary}
          </p>
          {article.updated && (
            <span className="text-faint">
              Обновлено {formatUpdated(article.updated)}
            </span>
          )}
        </div>
        {linkOpen && (
          <Button asChild variant="outline" className="flex-none self-start">
            <Link to={article.link} className="no-underline">
              {article.linkLabel}
            </Link>
          </Button>
        )}
      </header>

      <div className="flex items-start gap-7">
        {rail.length > 0 && (
          <BrowserView className="self-stretch border-r border-rule pr-4">
            <div className="sticky top-28 flex flex-col gap-1.5">
              <span className="text-xs font-bold tracking-wider text-faint uppercase">
                На этой странице
              </span>
              {/* key: у двух статей с равным числом заголовков якоря совпадают
                  (h-1…), и рейка не узнала бы, что страница другая */}
              <AnchorRail
                key={article.slug}
                sections={rail}
                ariaLabel="На этой странице"
                className="static w-44"
                quiet
              />
            </div>
          </BrowserView>
        )}
        <div className="min-w-0 flex-1">
          <div className="md-doc help-doc text-base leading-relaxed">
            <MarkdownViewer value={body} onRendered={onRendered} />
          </div>

          {article.siblings.length > 0 && (
            <nav
              aria-label="Дальше в разделе"
              className="mt-8 flex flex-col border-t border-rule pt-4"
            >
              <span className="pb-1.5 text-xs font-bold tracking-wider text-faint uppercase">
                Дальше в разделе
              </span>
              {article.siblings.map((sibling) => (
                <Link
                  key={sibling.slug}
                  to={articlePath(audience, section.key, sibling.slug)}
                  className="py-1.5 text-foreground-soft no-underline hover:text-accent-text"
                >
                  {sibling.title}
                </Link>
              ))}
            </nav>
          )}
        </div>
      </div>
    </div>
  );
};

export default HelpArticle;
