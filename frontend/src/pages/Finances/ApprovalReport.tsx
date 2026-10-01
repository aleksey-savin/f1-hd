import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";

import Crumbs, { type CrumbOrigin } from "@/components/app/Crumbs";
import AlertMessage from "@/components/app/AlertMessage";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import ReportCard from "../../components/Report/ReportCard";
import ReportExportMenu from "../../components/Report/ReportExportMenu";
import {
  StageMoreMenu,
  useStageActions,
} from "../../components/Report/StageActions";
import {
  subjectOfPreview,
  subjectOfReport,
} from "../../components/Report/stage-actions";
import useLiveTopic from "@/hooks/use-live-topic";
import { useCan } from "@/store/authed-user";
import { formatMonthLabel } from "../../util/format-date";

/**
 * Карточка отчёта в приложении — нам и клиенту под логином.
 *
 * Сам документ рисует `Report/ReportCard`: тот же компонент показывает отчёт и
 * по ссылке из письма. Здесь остаётся только то, что у поверхности своё —
 * загрузка, крошки и действия нашей стороны: сформировать, напомнить, выставить
 * счёт, подтвердить оплату, отправить в архив, вернуть на стадию назад (в том
 * числе из архива).
 *
 * Каждый ход, который двигает отчёт, идёт через общий диалог подтверждения
 * (`Report/StageActions`) — тот же, что у быстрых действий в списке стадии.
 */

const API = import.meta.env.VITE_API_ADDRESS;

const ApprovalReport = () => {
  const { id, companyId, servicePlanId, month } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  // Один компонент на две вещи: сохранённый отчёт и строку подбора, которая
  // отчётом ещё не стала. Разбор у них общий, различаются только действия.
  const isPreview = Boolean(companyId);

  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Куда уходить, когда карточки больше нет (отчёт сформирован из превью или
  // расформирован): туда, откуда пришли, — конвейер вернётся на ту же стадию и
  // тот же период
  const backTo =
    (location.state as { from?: CrumbOrigin } | null)?.from?.to ||
    "/finances/approval";

  const load = async () => {
    try {
      const url = isPreview
        ? `${API}/api/approval/preview/${companyId}/${servicePlanId}/${month}`
        : `${API}/api/approval/reports/${id}`;
      const response = await fetch(url);
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

  const stageActions = useStageActions({
    zone: data?.zone,
    onDone: ({ kind, dissolved }) => {
      if (kind === "submit" || dissolved) {
        navigate(backTo);
        return;
      }
      load();
    },
  });

  // Карточка живёт своей жизнью: клиент подписывает часть по ссылке из письма,
  // очередь двигается, в предпросмотр добавляются работы — состояние
  // подтягивается само по пульсу (docs/live-updates.md). На время нашего
  // действия пауза: ответ на него всё равно перечитает карточку, а
  // параллельная загрузка перетёрла бы свежий результат
  useLiveTopic("approval", load, {
    enabled: !busy && !stageActions.busy,
    minIntervalMs: 20_000,
  });

  const report = data?.report;
  const can = useCan();
  const isClientView = Boolean(data?.scope?.isClientView);
  // Конвейер (счёт, оплата, архив) ведёт тот, у кого есть на это право.
  // Прежде кнопки показывались всем, кто смотрит отчёт «нашими» глазами, и
  // нажатие возвращало 403 — гейт на маршруте стоял, а в интерфейсе нет.
  const canManageApproval = can({ approval: ["manage"] });

  const post = async (path: string, body: Record<string, unknown> = {}) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${API}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
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
      <div className="mx-auto w-full max-w-7xl">
        <AlertMessage variant="danger" message={error} />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-4">
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const blocked = (report.unrelatedWorks || []).length > 0;

  // О чём спрашивает диалог подтверждения. У превью отчёта ещё нет — предмет
  // собирается из строки подбора, вместе с составом будущего отчёта
  const subject = isPreview
    ? subjectOfPreview(
        {
          company: report.company,
          servicePlan: report.servicePlan,
          approval: {
            required: Boolean(report.approval?.required),
            bySubdivisions: Boolean(report.approval?.bySubdivisions),
            approver: report.approval?.finalApprover ?? null,
          },
          worksCount: report.worksCount,
          workIds: report.workIds,
          total: report.total,
        },
        {
          period: formatMonthLabel(report.month),
          sendDeadlineAt: report.sendDeadlineAt,
        },
      )
    : subjectOfReport(report);

  // Действия нашей стороны. У каждой стадии ровно одно главное — клиенту эта
  // ветка не достаётся вовсе: счёт и оплата не его процесс
  const actions = (
    <>
      <ReportExportMenu report={report} zone={data.zone} />

      {canManageApproval &&
        report.status === "declined" &&
        !report.canDecide && (
          <Button
            disabled={busy}
            onClick={() => post(`/api/approval/reports/${id}/resubmit`)}
          >
            Отправить повторно
          </Button>
        )}

      {/* Решение на этой стадии за клиентом — наш ход только напомнить,
          поэтому кнопка не залитая */}
      {canManageApproval && report.status === "pendingApproval" && (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => stageActions.open("remind", subject)}
        >
          Напомнить
        </Button>
      )}
      {canManageApproval && report.status === "approved" && (
        <Button
          disabled={busy}
          onClick={() => stageActions.open("invoice", subject)}
        >
          Выставить счёт
        </Button>
      )}
      {canManageApproval && report.status === "awaitingPayment" && (
        <Button
          disabled={busy}
          onClick={() => stageActions.open("payment", subject)}
        >
          Подтвердить оплату
        </Button>
      )}
      {canManageApproval && report.status === "paid" && (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => stageActions.open("archive", subject)}
        >
          В архив
        </Button>
      )}

      {isPreview && canManageApproval && (
        <Button
          disabled={busy || blocked}
          title={
            blocked
              ? "В отчёт попали бы работы, не привязанные ни к одной услуге"
              : undefined
          }
          onClick={() => stageActions.open("submit", subject)}
        >
          {report.approval?.required
            ? "Отправить на согласование"
            : "Утвердить"}
        </Button>
      )}

      {canManageApproval && !isPreview && (
        <StageMoreMenu
          status={report.status}
          disabled={busy}
          onRollback={() => stageActions.open("rollback", subject)}
        />
      )}
    </>
  );

  return (
    <>
      <ReportCard
        report={report}
        zone={data.zone}
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
        breadcrumb={<Crumbs />}
      />

      {stageActions.dialog}
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
