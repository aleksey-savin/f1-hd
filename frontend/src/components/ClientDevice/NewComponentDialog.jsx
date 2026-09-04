import { useEffect, useMemo, useState } from "react";

import { RiAddLine } from "react-icons/ri";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import AlertMessage from "@/components/app/AlertMessage";
import Combobox from "@/components/app/Combobox";
import DateField from "@/components/app/DateField";
import Field from "@/components/app/Field";

const refId = (value) => value?._id || value || "";

/**
 * Новая комплектующая сборки — короткая форма в диалоге: тип · производитель ·
 * модель · серийник · гарантия · количество. Полный мастер здесь не нужен —
 * компания, расположение, пользователь и статус наследуются от хозяина, а
 * закупка и сеть у планки памяти не спрашиваются.
 *
 * Создаётся как обычное устройство с `parentDeviceId`: комплектующее — такая же
 * единица учёта, просто не попадающая в общий список.
 */
const NewComponentDialog = ({ open, onOpenChange, host, onCreated }) => {
  const [catalog, setCatalog] = useState({
    deviceTypes: [],
    vendors: [],
    deviceModels: [],
  });
  const [form, setForm] = useState({
    deviceTypeId: "",
    vendorId: "",
    deviceModelId: "",
    serialNumber: "",
    warrantyExpirationDate: "",
    quantity: "1",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return undefined;
    setForm({
      deviceTypeId: "",
      vendorId: "",
      deviceModelId: "",
      serialNumber: "",
      warrantyExpirationDate: "",
      quantity: "1",
    });
    setError("");

    const headers = {};
    const base = import.meta.env.VITE_API_ADDRESS;
    let cancelled = false;

    (async () => {
      try {
        const responses = await Promise.all([
          fetch(`${base}/api/inventory/device-types`, { headers }),
          fetch(`${base}/api/inventory/vendors`, { headers }),
          fetch(`${base}/api/inventory/device-models`, { headers }),
        ]);
        const [deviceTypes, vendors, deviceModels] = await Promise.all(
          responses.map((response) => response.json()),
        );
        if (cancelled) return;
        setCatalog({
          deviceTypes: Array.isArray(deviceTypes) ? deviceTypes : [],
          vendors: Array.isArray(vendors) ? vendors : [],
          deviceModels: Array.isArray(deviceModels) ? deviceModels : [],
        });
      } catch {
        if (!cancelled) setError("Не удалось загрузить справочники");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  // В комплектующие годятся только типы, помеченные как часть, расходник или
  // периферия — тот же отбор, что у прикрепления существующего устройства.
  const typeOptions = useMemo(
    () =>
      catalog.deviceTypes
        .filter(
          (type) => type.isComponent || type.isConsumable || type.isPeripheral,
        )
        .map((type) => ({ value: type._id, label: type.name })),
    [catalog.deviceTypes],
  );
  const vendorOptions = useMemo(
    () =>
      catalog.vendors.map((vendor) => ({
        value: vendor._id,
        label: vendor.name,
      })),
    [catalog.vendors],
  );
  const modelOptions = useMemo(
    () =>
      catalog.deviceModels
        .filter(
          (model) =>
            (!form.deviceTypeId ||
              refId(model.deviceTypeId) === form.deviceTypeId) &&
            (!form.vendorId || refId(model.vendorId) === form.vendorId),
        )
        .map((model) => ({ value: model._id, label: model.name })),
    [catalog.deviceModels, form.deviceTypeId, form.vendorId],
  );

  const setField = (field, value) =>
    setForm((previous) => {
      const next = { ...previous, [field]: value };
      if (field === "deviceTypeId" || field === "vendorId")
        next.deviceModelId = "";
      return next;
    });

  const submit = async (event) => {
    event.preventDefault();
    if (!form.deviceTypeId) {
      setError("Выберите тип комплектующего");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/inventory/client-devices/add`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            parentDeviceId: host._id,
            // Комплектующее следует за хозяином: компания, расположение,
            // пользователь и статус — его.
            companyId: refId(host.companyId),
            locationId: refId(host.locationId),
            userId: refId(host.userId),
            status: host.status || "readyForDeployment",
            deviceModelId: form.deviceModelId || "",
            deviceTypeId: form.deviceModelId ? "" : form.deviceTypeId,
            serialNumber: form.serialNumber,
            warrantyExpirationDate: form.warrantyExpirationDate,
            quantity: Number(form.quantity) || 1,
          }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.message || "Не удалось создать комплектующее");
        return;
      }
      onCreated?.();
      onOpenChange(false);
    } catch {
      setError("Ошибка сети. Попробуйте ещё раз.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Новая комплектующая</DialogTitle>
            <DialogDescription>
              Компания, расположение и статус возьмутся у сборки. Полная
              карточка комплектующего открывается из состава.
            </DialogDescription>
          </DialogHeader>

          {error && <AlertMessage variant="danger" message={error} />}

          <div className="my-4">
            <Field label="Тип" htmlFor="component-type" required>
              <Combobox
                id="component-type"
                value={form.deviceTypeId || null}
                options={typeOptions}
                onChange={(value) => setField("deviceTypeId", value || "")}
                placeholder="Выберите тип"
                searchPlaceholder="Найти тип…"
                emptyText="Нет типов-комплектующих"
              />
            </Field>

            <div className="grid gap-x-3 sm:grid-cols-2">
              <Field label="Производитель" htmlFor="component-vendor">
                <Combobox
                  id="component-vendor"
                  value={form.vendorId || null}
                  options={vendorOptions}
                  onChange={(value) => setField("vendorId", value || "")}
                  placeholder="Не указан"
                  searchPlaceholder="Найти производителя…"
                  clearable
                />
              </Field>
              <Field label="Модель" htmlFor="component-model">
                <Combobox
                  id="component-model"
                  value={form.deviceModelId || null}
                  options={modelOptions}
                  onChange={(value) => setField("deviceModelId", value || "")}
                  placeholder={
                    form.vendorId ? "Выберите модель" : "Сначала производитель"
                  }
                  searchPlaceholder="Найти модель…"
                  emptyText="Моделей нет"
                  clearable
                  disabled={!form.vendorId}
                />
              </Field>
            </div>

            <div className="grid gap-x-3 sm:grid-cols-2">
              <Field label="Серийный номер" htmlFor="component-serial">
                <Input
                  id="component-serial"
                  value={form.serialNumber}
                  onChange={(event) =>
                    setField("serialNumber", event.target.value)
                  }
                  placeholder="Если есть"
                  className="font-mono"
                />
              </Field>
              <Field label="Количество" htmlFor="component-quantity">
                <Input
                  id="component-quantity"
                  type="number"
                  min="1"
                  value={form.quantity}
                  onChange={(event) => setField("quantity", event.target.value)}
                />
              </Field>
            </div>

            <Field label="Гарантия до" htmlFor="component-warranty">
              <DateField
                id="component-warranty"
                value={form.warrantyExpirationDate}
                onChange={(next) => setField("warrantyExpirationDate", next)}
                captionLayout="dropdown"
              />
            </Field>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={saving}
              onClick={() => onOpenChange(false)}
            >
              Отмена
            </Button>
            <Button type="submit" disabled={saving}>
              <RiAddLine /> {saving ? "Создаём…" : "Создать"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default NewComponentDialog;
