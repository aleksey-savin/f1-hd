import { useEffect, type ReactNode } from "react";

import { useActionData, useFetcher, useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import AlertMessage from "@/components/app/AlertMessage";
import useOffcanvasStore from "@/store/offcanvas";

// Форма из согласованного макета: заголовок 16/650 (кнопка «закрыть» —
// встроенный крестик шторки), поля, снизу справа «Отмена» и «Сохранить».
// Механика легаси сохранена: fetcher.Form на router-action, по успешному
// сабмиту закрываем шторку и уходим на successTo ?? "..". successTo-функция
// строит адрес из ответа action (создание → карточка созданной сущности,
// см. «Навигация после сабмита» в ux-ui-guide). Переход — replace: запись
// формы не остаётся в истории, «назад» ведёт туда, где форму открыли.
const FormWrapper = ({
  title,
  action,
  successTo,
  children,
}: {
  title: ReactNode;
  action?: string;
  successTo?: string | ((data: unknown) => string | undefined);
  children: ReactNode;
}) => {
  const data = useActionData() as
    | { message?: string; error?: boolean }
    | undefined;
  const offcanvas = useOffcanvasStore();

  const fetcher = useFetcher();
  const navigate = useNavigate();

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && !fetcher.data.error) {
      offcanvas.setClose();
      const to =
        typeof successTo === "function" ? successTo(fetcher.data) : successTo;
      navigate(to ?? "..", { replace: true });
    }
  }, [fetcher.state, fetcher.data]);

  const close = () => {
    offcanvas.setClose();
    navigate(-1);
  };

  // Без fade-обёртки: движение у формы одно — slide самой шторки
  return (
    <>
      <fetcher.Form method="post" action={action || "."}>
        <h1 className="tw:my-0 tw:mb-5 tw:pr-10 tw:text-2xl tw:font-semibold tw:tracking-tight">
          {title}
        </h1>
        {fetcher.data && fetcher.data.error && (
          <AlertMessage variant="danger" message={fetcher.data.message} />
        )}
        {data && data.message && data.error && (
          <AlertMessage variant="danger" message={data.message} />
        )}
        {data && data.message && !data.error && (
          <AlertMessage variant="success" message={data.message} />
        )}
        {children}
        <div className="tw:sticky tw:bottom-0 tw:-mx-6 tw:mt-6 tw:flex tw:items-center tw:justify-end tw:gap-2.5 tw:bg-background tw:px-6 tw:py-3">
          <Button type="button" variant="ghost" onClick={close}>
            Отмена
          </Button>
          <Button type="submit" disabled={fetcher.state !== "idle"}>
            Сохранить
          </Button>
        </div>
      </fetcher.Form>
    </>
  );
};

export default FormWrapper;
