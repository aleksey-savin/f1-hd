import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import FormSheet from "@/components/app/FormSheet";
import Field from "@/components/app/Field";
import Combobox from "@/components/app/Combobox";
import { FormActions } from "@/components/app/FormLayout";
import ReasonButton from "@/components/app/ReasonButton";

export default function CreateInventoryButton({
  recordId,
  companyId,
  disabled,
  onCreated,
}) {
  const [open, setOpen] = useState(false);
  const [locations, setLocations] = useState([]);
  const [locationId, setLocationId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setError(null);
    setLocationId("");
    setLocations([]);
    api(
      `/api/inventory/companies-locations?companyIds=${encodeURIComponent(companyId || "")}&includePublic=1`,
      { signal: controller.signal },
    )
      .then((rows) =>
        setLocations(
          rows.map((row) => ({
            value: row._id,
            label: row.fullPath || row.name,
          })),
        ),
      )
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message);
      });
    return () => controller.abort();
  }, [open, companyId]);
  const create = async () => {
    if (!locationId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api(
        `/api/inventory/mikrotik-devices/records/${recordId}/create-inventory`,
        { method: "POST", body: { locationId } },
      );
      setOpen(false);
      onCreated();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        Создать карточку
      </Button>
      <FormSheet
        open={open}
        onOpenChange={(value) => !busy && setOpen(value)}
        title="Создать карточку инвентаря"
      >
        <h2 className="mb-5 pr-10 text-xl font-semibold">
          Создать карточку инвентаря
        </h2>
        <Field label="Расположение" required>
          <Combobox
            ariaLabel="Расположение"
            value={locationId}
            options={locations}
            onChange={setLocationId}
            disabled={busy}
            placeholder="Выберите расположение"
          />
        </Field>
        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
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
          <ReasonButton
            disabled={busy}
            reason={!locationId ? "Выберите расположение" : null}
            onClick={create}
          >
            Создать
          </ReasonButton>
        </FormActions>
      </FormSheet>
    </>
  );
}
