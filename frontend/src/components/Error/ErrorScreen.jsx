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
  muted: "bg-faint",
  warning: "bg-warning",
  destructive: "bg-destructive",
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
      className="flex flex-col items-center justify-center px-4 text-center"
      style={{ minHeight: "62svh" }}
    >
      <div
        aria-hidden="true"
        className="flex items-center justify-center gap-1 text-8xl leading-none font-extrabold tracking-tighter text-faint tabular-nums select-none md:text-9xl"
      >
        {code ? (
          <>
            <span>{code[0]}</span>
            <span
              className="err-cat-settle"
              style={{ ...CAT_CROP, height: "0.92em" }}
            />
            <span>{code[1]}</span>
          </>
        ) : (
          <span className="err-cat-settle h-28 md:h-32" style={CAT_CROP} />
        )}
      </div>
      <h1 className="mt-5 mb-0 text-xl font-semibold text-balance">{title}</h1>
      <p className="mt-2 mb-0 max-w-md text-sm leading-relaxed text-pretty text-muted-foreground">
        {body}
      </p>
      {actions && (
        <div className="mt-6 flex flex-wrap justify-center gap-2.5">
          {actions}
        </div>
      )}
      {auto && (
        <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="err-pulse size-2 rounded-full bg-primary" />
          {auto}
        </div>
      )}
      {tech && (
        <div className="mt-7 flex items-center gap-2 text-xs text-faint tabular-nums">
          <span
            className={`size-1.5 rounded-full ${TECH_DOT[tech.tone ?? "muted"]}`}
          />
          {tech.text}
        </div>
      )}
    </div>
  );
};

export default ErrorScreen;
