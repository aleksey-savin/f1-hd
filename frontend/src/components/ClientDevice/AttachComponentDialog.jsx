import { useEffect, useState } from "react";

import { RiLinksLine } from "react-icons/ri";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import AlertMessage from "@/components/app/AlertMessage";
import Combobox from "@/components/app/Combobox";
import Field from "@/components/app/Field";

import { fetchAttachableDevices, describeDevice } from "./attachable";

const refId = (value) => value?._id || value || "";

/**
 * Прикрепление существующего устройства к сборке. Кандидаты — свободные
 * устройства той же компании с прикрепляемым типом (комплектующие, расходники,
 * периферия); после прикрепления комплектующее «следует за хостом» — компания,
 * расположение, пользователь и статус копируются с него (бэкенд).
 */
const AttachComponentDialog = ({ open, onOpenChange, device, onAttached }) => {
  const companyId = refId(device?.companyId);
  const hostTypeId =
    device?.deviceModelId?.deviceTypeId?._id || refId(device?.deviceTypeId);

  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [componentId, setComponentId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setComponentId(null);
    setError("");
    setLoading(true);
    let cancelled = false;
    fetchAttachableDevices({
      companyId,
      excludeId: device?._id,
      hostTypeId,
    }).then((list) => {
      if (cancelled) return;
      setOptions(
        list.map((candidate) => {
          const described = describeDevice(candidate);
          return {
            value: candidate._id,
            label: described.title,
            hint: [
              described.inventoryNumber || null,
              described.serialNumber ? `SN ${described.serialNumber}` : null,
              described.statusLabel,
            ]
              .filter(Boolean)
              .join(" · "),
          };
        }),
      );
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, companyId, hostTypeId, device?._id]);

  const submit = async () => {
    if (!componentId) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/inventory/client-devices/${device._id}/components`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ componentId }),
        },
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || "Не удалось прикрепить устройство");
      }
      onAttached?.();
      onOpenChange(false);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Прикрепить комплектующее</DialogTitle>
          <DialogDescription>
            Свободные устройства этой компании, тип которых можно прикрепить к
            сборке. Комплектующее переедет к хозяину: расположение, пользователь
            и статус станут общими.
          </DialogDescription>
        </DialogHeader>

        {error && <AlertMessage variant="danger" message={error} />}

        <Field label="Устройство" htmlFor="attach-component">
          <Combobox
            id="attach-component"
            value={componentId}
            options={options}
            onChange={setComponentId}
            placeholder={
              loading
                ? "Загружаем…"
                : options.length
                  ? "Выберите устройство"
                  : "Свободных комплектующих нет"
            }
            searchPlaceholder="Найти устройство…"
            emptyText="Ничего не нашлось"
            disabled={saving || loading || !options.length}
          />
        </Field>

        <DialogFooter>
          <Button
            variant="ghost"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            Отмена
          </Button>
          <Button disabled={saving || !componentId} onClick={submit}>
            <RiLinksLine /> {saving ? "Прикрепляем…" : "Прикрепить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AttachComponentDialog;
