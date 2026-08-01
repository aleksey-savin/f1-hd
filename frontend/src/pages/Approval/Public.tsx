import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { RiCheckLine, RiErrorWarningLine, RiLinkUnlink } from "react-icons/ri";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import ReportCard from "../../components/Report/ReportCard";
import { formatShortDate } from "../../util/format-date";

/**
 * Отчёт по ссылке из письма — без входа в приложение.
 *
 * Половина согласующих в портал не заходит, и требовать логин ради одной кнопки
 * значит не получить решения вовсе. Токен в адресе персональный и одноразовый,
 * он же удостоверяет подписанта — подпись остаётся именной.
 *
 * Показываем ТУ ЖЕ карточку, что и в кабинете (`Report/ReportCard`): подпись
 * ставится под одним и тем же документом, каким бы путём человек до него ни
 * дошёл. Оболочки приложения здесь нет — читать и решать можно, ходить по
 * разделам нельзя.
 */

const API = import.meta.env.VITE_API_ADDRESS;

const Public = () => {
  const { token } = useParams();
  const [data, setData] = useState<any>(null);
  const [failure, setFailure] = useState<{
    status: number;
    message: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | { approved: boolean }>(null);

  const load = async () => {
    try {
      const response = await fetch(`${API}/api/external/approval/${token}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        // Сообщения с сервера человеческие («Срок действия ссылки истёк») —
        // показываем их как есть: они называют, что произошло
        setFailure({
          status: response.status,
          message: payload?.message || "Ссылка недействительна",
        });
        return;
      }
      setData(payload);
      setFailure(null);
    } catch {
      setFailure({
        status: 0,
        message: "Не удалось связаться с сервером. Проверьте соединение.",
      });
    }
  };

  useEffect(() => {
    window.scrollTo(0, 0);
    load();
  }, [token]);

  if (failure) {
    return (
      <Message
        tone="warning"
        icon={<RiLinkUnlink />}
        title={failure.message}
        body="Запросите новую ссылку у исполнителя или откройте отчёт в личном кабинете — решение можно принять и там."
      />
    );
  }

  // Решение принято прямо здесь: дальше идти некуда, и держать человека на
  // странице с кнопками, которые больше ничего не делают, незачем
  if (done) {
    return (
      <Message
        tone={done.approved ? "success" : "warning"}
        icon={done.approved ? <RiCheckLine /> : <RiErrorWarningLine />}
        title={done.approved ? "Отчёт согласован" : "Отчёт отклонён"}
        body={
          done.approved
            ? "Спасибо. Мы получили вашу подпись."
            : "Мы получили ваш отказ. Исполнитель разберётся со спорной частью и пришлёт отчёт повторно."
        }
      />
    );
  }

  if (!data) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-4 p-4">
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const viewer = data.viewer
    ? `${data.viewer.lastName || ""} ${data.viewer.firstName || ""}`.trim()
    : null;

  return (
    <div className="min-h-svh bg-background">
      {/* Шапка вместо оболочки приложения: чей отчёт, кому адресован и до
          какого числа живёт ссылка — три вопроса, с которых начинают */}
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3">
          <b className="font-semibold">Отчёт на согласование</b>
          {viewer && (
            <span className="text-sm text-muted-foreground">
              для вас, {viewer}
            </span>
          )}
          {data.expiresAt && (
            <span className="ms-auto text-sm text-faint">
              ссылка действует до {formatShortDate(data.expiresAt)}
            </span>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 pt-4 pb-2">
        {/* Ссылка уже использована или подпись ждут не от вас: карточку
            показываем, кнопок решения не даём — сервер их всё равно отклонит */}
        {!data.canDecide && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-border bg-accent px-3.5 py-2.5 text-sm text-muted-foreground">
            <RiCheckLine className="flex-none" />
            {data.decides === "subdivision"
              ? "Ваша часть отчёта уже решена — отчёт открыт для просмотра."
              : "Сейчас решение не за вами: отчёт ждёт подписи руководителей подразделений."}
          </div>
        )}

        <ReportCard
          report={data.report}
          isClientView
          decisionBar
          busy={busy}
          error={error}
          onDecision={async ({ approve, comment }) => {
            setBusy(true);
            setError(null);
            try {
              const response = await fetch(
                `${API}/api/external/approval/${token}/decision`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ approve, comment }),
                },
              );
              const payload = await response.json().catch(() => ({}));
              if (!response.ok) {
                throw new Error(
                  payload?.message || "Не удалось записать решение",
                );
              }
              setDone({ approved: approve });
            } catch (decisionError) {
              setError((decisionError as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        />
      </main>
    </div>
  );
};

/**
 * Итоговый экран страницы по ссылке.
 *
 * Намеренно НЕ `components/Error/ErrorScreen`: тот носит маскота приложения, а
 * здесь человек со стороны клиента, который только что подписал финансовый
 * документ. Картинка из внутренних страниц ошибок в этом месте выглядит
 * несерьёзно, и к тому же согласование — не ошибка.
 */
const Message = ({
  tone,
  icon,
  title,
  body,
}: {
  tone: "success" | "warning";
  icon: React.ReactNode;
  title: string;
  body: string;
}) => (
  <div className="flex min-h-svh flex-col items-center justify-center bg-background px-4 text-center">
    <span
      aria-hidden
      className={cn(
        "grid size-14 place-items-center rounded-full text-2xl",
        tone === "success"
          ? "bg-primary/15 text-accent-text"
          : "bg-warning/15 text-warning",
      )}
    >
      {icon}
    </span>
    <h1 className="mt-5 mb-0 text-xl font-semibold text-balance">{title}</h1>
    <p className="mt-2 mb-0 max-w-md text-sm leading-relaxed text-pretty text-muted-foreground">
      {body}
    </p>
  </div>
);

export default Public;

export function loader() {
  document.title = "Согласование отчёта";
  return null;
}
