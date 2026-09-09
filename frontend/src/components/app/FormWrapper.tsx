import { useEffect, type ReactNode } from "react";

import { useActionData, useFetcher } from "react-router";

import { Button } from "@/components/ui/button";
import AlertMessage from "@/components/app/AlertMessage";
import { FormActions } from "@/components/app/FormLayout";
import { useFormSheet } from "@/components/app/FormOutlet";

// Форма из согласованного макета: заголовок 16/650 (кнопка «закрыть» —
// встроенный крестик шторки), поля, снизу справа «Отмена» и «Сохранить».
// Механика: fetcher.Form на router-action; по успешному сабмиту шторка
// закрывается через useFormSheet().close — сперва анимация ухода, затем
// переход на successTo ?? "..". successTo-функция строит адрес из ответа
// action (создание → карточка созданной сущности, см. «Навигация после
// сабмита» в ux-ui-guide). Переход — replace: запись формы не остаётся в
// истории, «назад» ведёт туда, где форму открыли. «Отмена» — close() без
// адреса: назад по истории, а с прямой ссылки на форму — к её хозяину.
const FormWrapper = ({
  title,
  header,
  action,
  successTo,
  onSuccess,
  json,
  formData,
  submitLabel = "Сохранить",
  submitDisabled = false,
  children,
}: {
  title: ReactNode;
  /**
   * Своя шапка вместо простого заголовка — например липкий `FormHeader` из
   * `app/FormLayout` (форма заявки: у неё есть подзаголовок с номером).
   * Передан — `title` идёт только в `aria-label` формы.
   */
  header?: ReactNode;
  action?: string;
  successTo?: string | ((data: unknown) => string | undefined);
  /** Убрать за собой после успешной отправки — до перехода со шторки. */
  onSuccess?: (data: unknown) => void;
  /**
   * Тело запроса собирает сама форма — тогда сабмит уходит JSON-ом, а не
   * FormData. Нужно там, где в теле массивы и булевы (см. «Сложное вложенное
   * тело — JSON» в ux-ui-guide): ручная сборка из FormData там становится
   * источником тихих потерь.
   */
  json?: () => unknown;
  /**
   * То же, но телом уходит FormData — единственный вариант, когда в форме есть
   * файлы: вложения заявки в JSON не положить. Взаимоисключающе с `json`.
   *
   * Вернуть `null` — отменить отправку: так форма показывает ошибки полей по
   * нажатию «Сохранить», не блокируя кнопку заранее (заблокированная кнопка не
   * объясняет, чего не хватает).
   */
  formData?: () => FormData | null;
  submitLabel?: string;
  submitDisabled?: boolean;
  children: ReactNode;
}) => {
  const data = useActionData() as
    | { message?: string; error?: boolean }
    | undefined;
  const fetcher = useFetcher();
  const { close } = useFormSheet();

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && !fetcher.data.error) {
      // Успех до перехода: форме бывает что убрать за собой — черновик
      // заявки страхует незакрытую шторку, а отправленную страховать нечего
      onSuccess?.(fetcher.data);
      const to =
        typeof successTo === "function" ? successTo(fetcher.data) : successTo;
      close(to ?? "..", { replace: true });
    }
  }, [fetcher.state, fetcher.data]);

  // Без fade-обёртки: движение у формы одно — slide самой шторки
  return (
    <>
      <fetcher.Form
        method="post"
        action={action || "."}
        encType={formData ? "multipart/form-data" : undefined}
        onSubmit={
          json || formData
            ? (event) => {
                event.preventDefault();
                if (formData) {
                  const body = formData();
                  if (!body) return;
                  fetcher.submit(body, {
                    method: "post",
                    action: action || ".",
                    encType: "multipart/form-data",
                  });
                  return;
                }
                fetcher.submit(json!() as Record<string, unknown>, {
                  method: "post",
                  action: action || ".",
                  encType: "application/json",
                });
              }
            : undefined
        }
      >
        {header ?? (
          <h1 className="my-0 mb-5 pr-10 text-xl font-semibold tracking-tight">
            {title}
          </h1>
        )}
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
        <FormActions className="justify-end">
          <Button type="button" variant="ghost" onClick={() => close()}>
            Отмена
          </Button>
          <Button
            type="submit"
            disabled={submitDisabled || fetcher.state !== "idle"}
          >
            {submitLabel}
          </Button>
        </FormActions>
      </fetcher.Form>
    </>
  );
};

export default FormWrapper;
