import { useEffect, useState } from "react";

import {
  RiCalendar2Line,
  RiDeleteBinLine,
  RiDownloadLine,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Panel, Eyebrow, Section, SectionEditLink } from "@/components/app/Panel";
import Field from "@/components/app/Field";
import useToastStore from "@/store/toast-store";

import ConfirmDialog from "./ConfirmDialog";
import { formatSchedule } from "./meta";
import useMikrotikDeviceFilterStore from "../../store/lists/mikrotik-devices";
import { formatDate } from "../../util/format-date";

const TRIGGER_LABEL = { manual: "вручную", scheduled: "по расписанию" };
const STORAGE_LABEL = { s3: "облако", local: "локально" };

const formatBytes = (bytes) => {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} КБ`;
  }
  return `${(bytes / (1024 * 1024)).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} МБ`;
};

// Секция «Конфигурации» страницы записи: расписание экспорта (только
// показывается — правит шторка `schedule`, вход — карандаш в метке; см.
// ScheduleForm и «одно поле — одно место правки» в гайде), «Экспортировать
// сейчас» — действие секции, копии со скачиванием по коду из письма (10 минут)
// и удалением. `schedule` приходит из loader'а страницы: после сохранения в
// шторке роутер перечитывает его сам.
const ConfigsSection = ({ recordId, schedule }) => {
  const showToast = useToastStore((state) => state.showToast);
  const store = useMikrotikDeviceFilterStore();

  const [artifacts, setArtifacts] = useState([]);
  const [exporting, setExporting] = useState(false);

  // 2FA-скачивание: {artifact, message, code, error, busy}
  const [download, setDownload] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const loadArtifacts = async () => {
    setArtifacts(await store.fetchArtifacts(recordId, "export"));
  };

  useEffect(() => {
    loadArtifacts();
  }, [recordId]);

  const exportNow = async () => {
    setExporting(true);
    try {
      const response = await store.createExport(recordId);
      const data = await response.json().catch(() => ({}));
      showToast(
        response.ok ? "success" : "danger",
        data.message ||
          (response.ok
            ? "Конфигурация экспортирована"
            : "Не удалось экспортировать конфигурацию"),
      );
      if (response.ok) {
        await loadArtifacts();
        store.patchRow(recordId, { lastExportAt: new Date().toISOString() });
      }
    } finally {
      setExporting(false);
    }
  };

  const startDownload = async (artifact) => {
    const response = await store.requestDownloadCode(recordId, artifact.id);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      showToast("danger", data.message || "Не удалось отправить код");
      return;
    }
    setDownload({
      artifact,
      message: data.message,
      code: "",
      error: null,
      busy: false,
    });
  };

  const submitDownload = async () => {
    if (!download) return;
    setDownload((prev) => ({ ...prev, busy: true, error: null }));
    const response = await store.downloadArtifact(
      recordId,
      download.artifact.id,
      download.artifact.fileName,
      download.code.trim(),
    );
    if (response.ok) {
      setDownload(null);
      showToast("success", "Файл скачан");
      return;
    }
    const data = await response.json().catch(() => ({}));
    setDownload((prev) =>
      prev
        ? {
            ...prev,
            busy: false,
            error: data.message || "Не удалось скачать файл",
          }
        : prev,
    );
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      const response = await store.deleteArtifact(recordId, deleting.id);
      const data = await response.json().catch(() => ({}));
      showToast(
        response.ok ? "success" : "danger",
        data.message ||
          (response.ok ? "Копия удалена" : "Не удалось удалить копию"),
      );
      if (response.ok) {
        setDeleting(null);
        await loadArtifacts();
      }
    } finally {
      setDeleteBusy(false);
    }
  };

  const scheduleText = formatSchedule(schedule);

  return (
    <Section>
      <Eyebrow
        id="configs"
        count={artifacts.length}
        action={
          <>
            <SectionEditLink to="schedule" label="Конфигурации" />
            <Button
              variant="outline"
              size="xs"
              disabled={exporting}
              onClick={exportNow}
            >
              {exporting ? "Экспортируем…" : "Экспортировать сейчас"}
            </Button>
          </>
        }
      >
        Конфигурации
      </Eyebrow>
      <Panel>
        {/* Расписание — сводка; правка в шторке `schedule` */}
        <div className="flex items-center gap-2.5 border-b border-border-soft pb-3 text-sm">
          <RiCalendar2Line
            size={16}
            aria-hidden
            className="flex-none text-faint"
          />
          <span className="min-w-0 flex-1 truncate">
            {scheduleText ? (
              <>
                Экспорт {scheduleText} · хранить {schedule?.keepLast ?? 10}{" "}
                {(schedule?.keepLast ?? 10) === 1 ? "копию" : "копий"}
                {schedule?.nextRunAt && (
                  <span className="text-faint">
                    {" "}
                    · следующий запуск {formatDate(schedule.nextRunAt)}
                  </span>
                )}
              </>
            ) : (
              <span className="text-muted-foreground">
                Экспорт по расписанию выключен.
              </span>
            )}
            {schedule?.lastError && (
              <span className="block truncate text-xs text-destructive">
                Последний запуск с ошибкой: {schedule.lastError}
              </span>
            )}
          </span>
        </div>

        {/* Копии */}
        {artifacts.length === 0 ? (
          <div className="pt-3 text-sm text-faint">
            Сохранённых копий пока нет — запустите экспорт или включите
            расписание.
          </div>
        ) : (
          artifacts.map((artifact) => (
            <div
              key={artifact.id}
              className="flex items-center gap-3.5 border-b border-border-soft py-2 text-sm last:border-b-0"
            >
              <span className="min-w-0 flex-1 truncate tabular-nums">
                {formatDate(artifact.createdAt)}
                <span className="text-faint">
                  {" "}
                  · {TRIGGER_LABEL[artifact.trigger] || artifact.trigger} ·{" "}
                  {STORAGE_LABEL[artifact.storage] || artifact.storage}
                </span>
              </span>
              <span className="w-20 flex-none text-muted-foreground tabular-nums">
                {formatBytes(artifact.size)}
              </span>
              <span className="flex flex-none gap-1.5">
                <Button
                  variant="outline"
                  size="icon-sm"
                  title="Скачать (код придёт на почту)"
                  aria-label="Скачать"
                  onClick={() => startDownload(artifact)}
                >
                  <RiDownloadLine />
                </Button>
                <Button
                  variant="outline"
                  size="icon-sm"
                  title="Удалить копию"
                  aria-label="Удалить копию"
                  onClick={() => setDeleting(artifact)}
                >
                  <RiDeleteBinLine />
                </Button>
              </span>
            </div>
          ))
        )}
        <div className="pt-3 text-xs text-faint">
          Скачивание — по коду из письма, код действует 10 минут.
        </div>
      </Panel>

      {/* 2FA-диалог скачивания */}
      <Dialog
        open={Boolean(download)}
        onOpenChange={(open) => {
          if (!open) setDownload(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Скачивание конфигурации</DialogTitle>
            <DialogDescription>
              {download?.message || "Код отправлен на вашу почту."} Файл:{" "}
              {download?.artifact.fileName}
            </DialogDescription>
          </DialogHeader>
          <Field label="Код из письма" htmlFor="download-code">
            <Input
              id="download-code"
              inputMode="numeric"
              maxLength={6}
              autoFocus
              value={download?.code || ""}
              onChange={(event) =>
                setDownload((prev) =>
                  prev ? { ...prev, code: event.target.value } : prev,
                )
              }
              className="font-mono tracking-widest"
              placeholder="000000"
            />
          </Field>
          {download?.error && (
            <div className="text-sm text-destructive">{download.error}</div>
          )}
          <DialogFooter className="mt-2 items-center">
            <Button
              variant="ghost"
              size="sm"
              className="me-auto"
              onClick={() => startDownload(download.artifact)}
            >
              Отправить новый код
            </Button>
            <Button variant="ghost" onClick={() => setDownload(null)}>
              Отмена
            </Button>
            <Button
              disabled={
                download?.busy || !/^\d{6}$/.test(download?.code?.trim() || "")
              }
              onClick={submitDownload}
            >
              {download?.busy ? "Проверяем…" : "Скачать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={deleting ? `Копия от ${formatDate(deleting.createdAt)}` : ""}
        description="Файл конфигурации будет удалён безвозвратно."
        onConfirm={confirmDelete}
        isLoading={deleteBusy}
      />
    </Section>
  );
};

export default ConfigsSection;
