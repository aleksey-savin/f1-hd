import { useEffect } from "react";
import { useFetcher } from "react-router";

import { Button } from "@/components/ui/button";

import useToastStore from "../../store/toast-store";

// Оболочка секции «Настроек системы»: контент + футер с «Сохранить». Сабмит —
// JSON на action страницы (бэкенд обновляет только присланную группу),
// результат — глобальный тост. Секция без сохранения (сервисные действия)
// рендерит контент без футера — этой обёрткой не пользуется.
const SectionForm = ({ buildPayload, disabled = false, children }) => {
  const fetcher = useFetcher();
  const { showToast } = useToastStore();

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.message) {
      showToast(
        fetcher.data.error ? "danger" : "success",
        fetcher.data.message,
      );
    }
  }, [fetcher.state, fetcher.data]);

  const submitHandler = () =>
    fetcher.submit(buildPayload(), {
      method: "post",
      encType: "application/json",
    });

  return (
    <>
      {children}
      <div className="flex justify-end border-t border-border-soft px-5 py-3">
        <Button
          onClick={submitHandler}
          disabled={disabled || fetcher.state !== "idle"}
          className="max-md:w-full"
        >
          {fetcher.state !== "idle" ? "Сохранение…" : "Сохранить"}
        </Button>
      </div>
    </>
  );
};

export default SectionForm;
