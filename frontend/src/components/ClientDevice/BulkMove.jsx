import { useEffect, useState } from "react";
import { RiMapPin2Line } from "react-icons/ri";
import BulkActionBar from "@/components/app/BulkActionBar";
import FormSheet from "@/components/app/FormSheet";
import { FormActions } from "@/components/app/FormLayout";
import Field from "@/components/app/Field";
import Combobox from "@/components/app/Combobox";
import ReasonButton from "@/components/app/ReasonButton";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

export default function BulkMove({ selection, onComplete }) {
  const [open, setOpen] = useState(false);
  const [locationId, setLocationId] = useState("");
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [revision, setRevision] = useState(0);
  const key = JSON.stringify(selection.selectedIds);
  useEffect(() => {
    const controller = new AbortController();
    setPreview(null);
    if (selection.count) {
      api("/api/inventory/client-devices/move-preview", {
        method: "POST",
        body: { ids: JSON.parse(key) },
        signal: controller.signal,
      })
        .then((result) => setPreview({ ...result, key }))
        .catch((error) => {
          if (!controller.signal.aborted)
            setPreview({ key, reason: error.message, locations: [] });
        });
    }
    return () => controller.abort();
  }, [key, revision]);
  useEffect(() => {
    if (!selection.isActive) setOpen(false);
  }, [selection.isActive]);
  const current = preview?.key === key ? preview : null;
  const reason = selection.loading
    ? "Загружаем выбранные устройства"
    : !selection.count
      ? "Выберите устройства"
      : !current
        ? "Проверяем выбранные устройства"
        : current.reason;
  const submitReason =
    reason ||
    (!locationId
      ? "Выберите расположение"
      : !current?.locations.some((entry) => entry.value === locationId)
        ? "Расположение недоступно для выбранных устройств"
        : null);
  const submit = async () => {
    if (submitReason || busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const result = await api("/api/inventory/client-devices/move", {
        method: "POST",
        body: { ids: selection.selectedIds, locationId },
      });
      setFeedback(result);
      await onComplete();
      setRevision((value) => value + 1);
      if (!result.error) setOpen(false);
    } catch (error) {
      setFeedback({ error: true, message: error.message });
      setRevision((value) => value + 1);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {feedback && !open && (
        <p role="status" className="px-5 py-3 text-sm">
          {feedback.message}
        </p>
      )}
      {selection.error && (
        <p role="alert" className="px-5 text-sm text-destructive">
          {selection.error}
        </p>
      )}
      <BulkActionBar
        count={selection.count}
        show={selection.isActive}
        isLoading={busy}
        actions={[
          { key: "move", icon: RiMapPin2Line, label: "Переместить", reason },
        ]}
        onPick={() => {
          setLocationId("");
          setFeedback(null);
          setOpen(true);
        }}
        statusText={
          selection.loading ? "Загружаем выбор…" : `Выбрано: ${selection.count}`
        }
      />
      <FormSheet
        open={open}
        onOpenChange={(value) => !busy && setOpen(value)}
        title="Переместить устройства"
      >
        <h2 className="mb-2 pr-10 text-xl font-semibold tracking-tight">
          Переместить устройства
        </h2>
        <p className="mb-5 text-sm text-muted-foreground">
          Выбрано устройств: {selection.count}. Комплектующие переместятся
          вместе с устройствами.
        </p>
        <Field label="Расположение" required>
          <Combobox
            ariaLabel="Расположение"
            value={locationId}
            onChange={setLocationId}
            options={current?.locations || []}
            placeholder="Выберите расположение"
            disabled={busy}
          />
        </Field>
        {submitReason && (
          <p role="status" className="mt-3 text-sm text-muted-foreground">
            {submitReason}
          </p>
        )}
        {feedback && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {feedback.message}
          </p>
        )}
        <FormActions className="justify-end">
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            Отмена
          </Button>
          <ReasonButton reason={submitReason} disabled={busy} onClick={submit}>
            Переместить
          </ReasonButton>
        </FormActions>
      </FormSheet>
    </>
  );
}
