import { type ReactNode } from "react";

import PageHeader from "@/components/app/PageHeader";

// Каркас страницы, у которой есть заголовок и строка инструментов, но нет
// сортировки и пагинации, — поэтому ListWrapper не подходит. Шапка та же, что у
// списков (app/PageHeader): заголовок слева, тулбар (сегмент режимов, период,
// экспорт) справа, главное действие в углу; при сужении окна переносится
// ступенями, отдельной мобильной ветки не требуется.
//
// Жил в components/Report как ReportShell, пока пользователем был один отчёт.
// Сейчас каркас делят все три отчёта, календарь команды, согласование работ и
// главная — предмет у него не отчётный, а страничный, поэтому переехал сюда.
const PageShell = ({
  title,
  subtitle,
  toolbar,
  search,
  action,
  breadcrumb,
  icon,
  wide = false,
  children,
}: {
  title: string;
  /** Строка под заголовком: должность, ставка и т.п. */
  subtitle?: ReactNode;
  toolbar?: ReactNode;
  /** Поиск по странице (сети): шапка сама задаёт ему ширину. */
  search?: ReactNode;
  /** Главное действие страницы («Отсутствие» у календаря) — в правом верхнем
   *  углу на любой ширине, а не в хвосте тулбара. */
  action?: ReactNode;
  /** Возврат к списку/сводной — крошками сверху, как на карточках сущностей. */
  breadcrumb?: ReactNode;
  /** Плитка-монограмма слева от заголовка (карточки компании и подразделения). */
  icon?: ReactNode;
  /**
   * Широкая раскладка (1600) вместо стандартной 1280 — для табеля «Графики
   * работы»: 31 колонка дней плюс липкие колонки сотрудника и итогов.
   * Ширину дублирует запись в MIGRATED_ROUTES (layout/Root.jsx).
   */
  wide?: boolean;
  children: ReactNode;
}) => (
  <div
    // 1600 (100rem) нет во встроенной сетке tailwind, а произвольные значения
    // в классах гайд запрещает — ширину задаём стилем; в rem, чтобы личный
    // масштаб текста растягивал и страницу, как зум браузера
    className={wide ? "mx-auto w-full" : "mx-auto w-full max-w-7xl"}
    style={wide ? { maxWidth: "100rem" } : undefined}
  >
    {breadcrumb && <div className="mb-3">{breadcrumb}</div>}
    <PageHeader
      className="mb-4"
      title={
        <div className="flex items-center gap-2.5">
          {icon}
          <div className="min-w-0">
            <h1 className="my-0 text-3xl leading-none font-semibold tracking-tight">
              {title}
            </h1>
            {subtitle && (
              <div className="mt-1.5 text-sm text-muted-foreground">
                {subtitle}
              </div>
            )}
          </div>
        </div>
      }
      search={search}
      controls={toolbar}
      action={action}
    />
    {children}
  </div>
);

export default PageShell;
