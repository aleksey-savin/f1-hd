import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { RiArrowLeftSLine } from "react-icons/ri";

import AlertMessage from "@/components/app/AlertMessage";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

import ReportCard from "../../components/Report/ReportCard";
import ReportExportMenu from "../../components/Report/ReportExportMenu";
import usePolling from "../../hooks/use-polling";
import { getLocalStorageData } from "../../util/auth";
import { toDateInputValue } from "../../util/format-date";

/**
 * Карточка отчёта в приложении — нам и клиенту под логином.
 *
 * Сам документ рисует `Report/ReportCard`: тот же компонент показывает отчёт и
 * по ссылке из письма. Здесь остаётся только то, что у поверхности своё —
 * загрузка, крошки и действия нашей стороны: сформировать, выставить счёт,
 * подтвердить оплату, отправить в архив.
 */

const API = import.meta.env.VITE_API_ADDRESS;

const ApprovalReport = () => {
  const { id, companyId, servicePlanId, month } = useParams();
  const navigate = useNavigate();
  // Один компонент на две вещи: сохранённый отчёт и строку подбора, которая
  // отчётом ещё не стала. Разбор у них общий, различаются только действия.
  const isPreview = Boolean(companyId);

  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stageForm, setStageForm] = useState<"invoice" | "payment" | null>(null);
  const [invoice, setInvoice] = useState({
    number: "",
    date: toDateInputValue(new Date()),
  });
  const [paidAt, setPaidAt] = useState(toDateInputValue(new Date()));

  const load = async () => {
    try {
      const { token } = getLocalStorageData();
      const url = isPreview
        ? `${API}/api/approval/preview/${companyId}/${servicePlanId}/${month}`
        : `${API}/api/approval/reports/${id}`;
      const response = await fetch(url, {
        headers: { Authorization: "Bearer " + token },
      });
      if (!response.ok) throw new Error(`report ${response.status}`);
      setData(await response.json());
      setError(null);
    } catch (loadError) {
      console.warn("Отчёт не загрузился:", loadError);
      setError("Не удалось открыть отчёт. Проверьте соединение и повторите.");
    }
  };

  useEffect(() => {
    window.scrollTo(0, 0);
    load();
  }, [id, companyId, servicePlanId, month]);

  // Карточка живёт своей жизнью: клиент подписывает часть по ссылке из письма,
  // очередь двигается — состояние обязано подтягиваться само, как в конвейере.
  // На время нашего действия опрос выключен: ответ на него всё равно перечитает
  // карточку, а параллельная загрузка перетёрла бы свежий результат
  usePolling(() => (isPreview ? undefined : load()), {
    intervalMs: 20000,
    enabled: !busy,
  });

  const report = data?.report;
  const isClientView = Boolean(data?.scope?.isClientView);

  const post = async (path: string, body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const { token } = getLocalStorageData();
      const response = await fetch(`${API}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.message || "Не удалось выполнить действие");
      }
      await load();
      return true;
    } catch (actionError) {
      setError((actionError as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (error && !report) {
    return (
      <div className="tw:mx-auto tw:w-full tw:max-w-7xl">
        <AlertMessage variant="danger" message={error} />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="tw:mx-auto tw:w-full tw:max-w-7xl tw:space-y-4">
        <Skeleton className="tw:h-20 tw:rounded-xl" />
        <Skeleton className="tw:h-40 tw:rounded-xl" />
        <Skeleton className="tw:h-64 tw:rounded-xl" />
      </div>
    );
  }

  const blocked = (report.unrelatedWorks || []).length > 0;

  // Действия нашей стороны. У каждой стадии ровно одно главное — клиенту эта
  // ветка не достаётся вовсе: счёт и оплата не его процесс
  const actions = (
    <>
      <ReportExportMenu report={report} />

      {!isClientView && report.status === "declined" && !report.canDecide && (
        <Button
          disabled={busy}
          onClick={() => post(`/api/approval/reports/${id}/resubmit`, {})}
        >
          Отправить повторно
        </Button>
      )}

      {!isClientView && report.status === "approved" && (
        <Button disabled={busy} onClick={() => setStageForm("invoice")}>
          Выставить счёт
        </Button>
      )}
      {!isClientView && report.status === "awaitingPayment" && (
        <Button disabled={busy} onClick={() => setStageForm("payment")}>
          Подтвердить оплату
        </Button>
      )}
      {!isClientView && report.status === "paid" && (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => post(`/api/approval/reports/${id}/archive`, {})}
        >
          В архив
        </Button>
      )}

      {isPreview && (
        <Button
          disabled={busy || blocked}
          title={
            blocked
              ? "В отчёт попали бы работы, не привязанные ни к одной услуге"
              : undefined
          }
          onClick={async () => {
            const ok = await post("/api/approval/reports", {
              companyId: report.company._id,
              servicePlanId: report.servicePlan._id,
              workIds: report.workIds,
            });
            if (ok) navigate("/finances/approval");
          }}
        >
          {report.approval?.required ? "Отправить на согласование" : "Утвердить"}
        </Button>
      )}
    </>
  );

  return (
    <>
      <ReportCard
        report={report}
        isPreview={isPreview}
        isClientView={isClientView}
        busy={busy}
        error={error}
        actions={actions}
        onFixed={load}
        onDecision={({ approve, comment, subdivisionId }) =>
          post(`/api/approval/reports/${id}/decision`, {
            approve,
            comment,
            subdivisionId,
          }).then(() => undefined)
        }
        breadcrumb={
          <Link
            to="/finances/approval"
            className="tw:mb-4 tw:inline-flex tw:items-center tw:gap-1 tw:text-sm tw:font-medium tw:text-muted-foreground tw:no-underline tw:hover:text-foreground"
          >
            <RiArrowLeftSLine /> Согласование работ
          </Link>
        }
      />

      <Dialog
        open={Boolean(stageForm)}
        onOpenChange={(open) => !open && setStageForm(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {stageForm === "invoice" ? "Выставить счёт" : "Подтвердить оплату"}
            </DialogTitle>
          </DialogHeader>

          {stageForm === "invoice" ? (
            <div className="tw:grid tw:gap-3 tw:sm:grid-cols-2">
              <div>
                <Label htmlFor="inv-number" className="tw:mb-1.5 tw:text-sm">
                  Номер счёта
                </Label>
                <Input
                  id="inv-number"
                  value={invoice.number}
                  onChange={(event) =>
                    setInvoice({ ...invoice, number: event.target.value })
                  }
                />
              </div>
              <div>
                <Label htmlFor="inv-date" className="tw:mb-1.5 tw:text-sm">
                  Дата счёта
                </Label>
                <Input
                  id="inv-date"
                  type="date"
                  value={invoice.date}
                  onChange={(event) =>
                    setInvoice({ ...invoice, date: event.target.value })
                  }
                />
              </div>
            </div>
          ) : (
            <div>
              <Label htmlFor="paid-at" className="tw:mb-1.5 tw:text-sm">
                Дата полной оплаты
              </Label>
              <Input
                id="paid-at"
                type="date"
                value={paidAt}
                onChange={(event) => setPaidAt(event.target.value)}
              />
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setStageForm(null)}>
              Отмена
            </Button>
            <Button
              disabled={busy || (stageForm === "invoice" && !invoice.number.trim())}
              onClick={async () => {
                const ok =
                  stageForm === "invoice"
                    ? await post(`/api/approval/reports/${id}/invoice`, invoice)
                    : await post(`/api/approval/reports/${id}/payment`, { paidAt });
                if (ok) setStageForm(null);
              }}
            >
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ApprovalReport;

export function loader() {
  document.title = "Просмотр отчёта";
  return null;
}

export function previewLoader() {
  document.title = "Проверка расчёта";
  return null;
}
