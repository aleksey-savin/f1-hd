import { type ReactNode } from "react";

// Каркас страницы, у которой есть заголовок и строка инструментов, но нет
// поиска, сортировки и пагинации, — поэтому ListWrapper не подходит. Заголовок
// в языке ListWrapper, тулбар (сегмент режимов, период, экспорт) справа.
// Раскладка адаптивная (flex-wrap), отдельной мобильной ветки не требуется.
//
// Жил в components/Report как ReportShell, пока пользователем был один отчёт.
// Сейчас каркас делят все три отчёта, календарь команды, согласование работ и
// главная — предмет у него не отчётный, а страничный, поэтому переехал сюда.
const PageShell = ({
  title,
  subtitle,
  toolbar,
  breadcrumb,
  icon,
  wide = false,
  children,
}: {
  title: string;
  /** Строка под заголовком: должность, ставка и т.п. */
  subtitle?: ReactNode;
  toolbar?: ReactNode;
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
    <div className="mb-4 flex flex-wrap items-center gap-x-2.5 gap-y-3">
      {icon}
      <div>
        <h1 className="my-0 text-3xl leading-none font-semibold tracking-tight">
          {title}
        </h1>
        {subtitle && (
          <div className="mt-1.5 text-sm text-muted-foreground">{subtitle}</div>
        )}
      </div>
      <div className="ms-auto flex flex-wrap items-center gap-2.5">
        {toolbar}
      </div>
    </div>
    {children}
  </div>
);

export default PageShell;
