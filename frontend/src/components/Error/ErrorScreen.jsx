import useDocTitle from "../../hooks/use-doc-title";

// Кот-талисман: янтарный овал вырезается из public/error-emoji.png по
// пиксельным границам непрозрачной области (bbox 264×307 в файле 424×564).
const CAT_CROP = {
  aspectRatio: "264 / 307",
  backgroundImage: 'url("/error-emoji.png")',
  backgroundSize: "160.6% auto",
  backgroundPosition: "51.9% 28%",
  backgroundRepeat: "no-repeat",
};

const TECH_DOT = {
  muted: "tw:bg-faint",
  warning: "tw:bg-warning",
  destructive: "tw:bg-destructive",
};

/**
 * Каркас страницы ошибки: код с котом вместо средней цифры (кот соло, когда
 * HTTP-кода нет — `code={null}`), заголовок, пояснение, действия, строка
 * автоповтора (`auto`) и тихая тех-строка (`tech`) — чтобы скриншот от
 * пользователя сразу говорил админу код и путь.
 */
// Значения по умолчанию не косметика: без них TypeScript у вызывающих
// .tsx-страниц считает ВСЕ поля обязательными и требует передавать пустые
// actions/auto/tech там, где их и не бывает
const ErrorScreen = ({
  code,
  title,
  body,
  actions = null,
  auto = null,
  tech = null,
  docTitle = "",
}) => {
  useDocTitle(docTitle || title);

  return (
    <div
      className="tw:flex tw:flex-col tw:items-center tw:justify-center tw:px-4 tw:text-center"
      style={{ minHeight: "62svh" }}
    >
      <div
        aria-hidden="true"
        className="tw:flex tw:items-center tw:justify-center tw:gap-1 tw:text-8xl tw:leading-none tw:font-extrabold tw:tracking-tighter tw:text-faint tw:tabular-nums tw:select-none tw:md:text-9xl"
      >
        {code ? (
          <>
            <span>{code[0]}</span>
            <span
              className="tw:err-cat-settle"
              style={{ ...CAT_CROP, height: "0.92em" }}
            />
            <span>{code[1]}</span>
          </>
        ) : (
          <span
            className="tw:err-cat-settle tw:h-28 tw:md:h-32"
            style={CAT_CROP}
          />
        )}
      </div>
      <h1 className="tw:mt-5 tw:mb-0 tw:text-xl tw:font-semibold tw:text-balance">
        {title}
      </h1>
      <p className="tw:mt-2 tw:mb-0 tw:max-w-md tw:text-sm tw:leading-relaxed tw:text-pretty tw:text-muted-foreground">
        {body}
      </p>
      {actions && (
        <div className="tw:mt-6 tw:flex tw:flex-wrap tw:justify-center tw:gap-2.5">
          {actions}
        </div>
      )}
      {auto && (
        <div className="tw:mt-4 tw:flex tw:items-center tw:gap-2 tw:text-xs tw:text-muted-foreground">
          <span className="tw:err-pulse tw:size-2 tw:rounded-full tw:bg-primary" />
          {auto}
        </div>
      )}
      {tech && (
        <div className="tw:mt-7 tw:flex tw:items-center tw:gap-2 tw:text-xs tw:text-faint tw:tabular-nums">
          <span
            className={`tw:size-1.5 tw:rounded-full ${TECH_DOT[tech.tone ?? "muted"]}`}
          />
          {tech.text}
        </div>
      )}
    </div>
  );
};

export default ErrorScreen;
