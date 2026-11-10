import { useEffect, useState } from "react";
import Combobox from "@/components/app/Combobox";
import Field from "@/components/app/Field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
const newId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
function NetworkLink({ item, onChange, onRemove }) {
  const [options, setOptions] = useState({
    connections: [],
    routers: [],
    nodes: [],
    bridges: [],
    interfaces: [],
    interfaceLists: [],
  });
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams(
      Object.entries({
        connectionId: item.connectionId,
        nodeName: item.nodeName,
        routerId: item.routerId,
      }).filter(([, v]) => v),
    );
    setError("");
    api(`/api/proxmox/exposure/options?${query}`, { signal: controller.signal })
      .then(setOptions)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [item.connectionId, item.nodeName, item.routerId]);
  const field = (label, key, choices, extra = {}) => (
    <Field label={label}>
      <Combobox
        ariaLabel={label}
        value={item[key] || ""}
        options={choices || []}
        clearable={false}
        onChange={(value) => onChange({ ...item, [key]: value, ...extra })}
      />
    </Field>
  );
  return (
    <div className="mt-4 rounded-xl border border-border-soft p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {field("Подключение Proxmox", "connectionId", options.connections, {
          nodeName: "",
          bridge: "",
        })}
        {field("Узел", "nodeName", options.nodes, { bridge: "" })}
        {field("Bridge гостя", "bridge", options.bridges)}
        <Field label="VLAN">
          <Input
            aria-label="VLAN"
            inputMode="numeric"
            placeholder="Без VLAN"
            value={item.vlan ?? ""}
            onChange={(event) =>
              onChange({
                ...item,
                vlan:
                  event.target.value === "" ? null : Number(event.target.value),
              })
            }
          />
        </Field>
        <Field label="IPv4-подсеть">
          <Input
            aria-label="IPv4-подсеть"
            placeholder="10.20.0.0/24"
            value={item.cidr || ""}
            onChange={(event) =>
              onChange({ ...item, cidr: event.target.value })
            }
          />
        </Field>
        {field("MikroTik", "routerId", options.routers, {
          lanInterface: "",
          wan: { kind: "interface", name: "" },
        })}
        {field(
          "Внутренний интерфейс MikroTik",
          "lanInterface",
          options.interfaces,
        )}
        <Field label="Внешний вход">
          <Combobox
            ariaLabel="Тип внешнего входа"
            clearable={false}
            value={item.wan.kind}
            options={[
              { value: "interface", label: "Интерфейс" },
              { value: "list", label: "Список интерфейсов" },
            ]}
            onChange={(kind) => onChange({ ...item, wan: { kind, name: "" } })}
          />
          <Combobox
            ariaLabel="Внешний интерфейс MikroTik"
            clearable={false}
            value={item.wan.name}
            options={
              item.wan.kind === "list"
                ? options.interfaceLists
                : options.interfaces
            }
            onChange={(name) =>
              onChange({ ...item, wan: { ...item.wan, name } })
            }
          />
        </Field>
      </div>
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      <div className="mt-3 flex justify-end">
        <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
          Удалить связь
        </Button>
      </div>
    </div>
  );
}
export default function ProxmoxNetworks({ value = [], onChange, canEdit }) {
  if (!canEdit) return null;
  return (
    <div className="mt-6 border-t border-border-soft pt-5">
      <h3 className="text-sm font-medium">Связи с MikroTik</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Укажите, через какой роутер проверять пробросы для сети гостевых машин.
      </p>
      {value.map((item, index) => (
        <NetworkLink
          key={item._id}
          item={item}
          onChange={(next) =>
            onChange(value.map((row, i) => (i === index ? next : row)))
          }
          onRemove={() => onChange(value.filter((_, i) => i !== index))}
        />
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-4"
        onClick={() =>
          onChange([
            ...value,
            {
              _id: newId(),
              connectionId: "",
              nodeName: "",
              bridge: "",
              vlan: null,
              cidr: "",
              routerId: "",
              lanInterface: "",
              wan: { kind: "interface", name: "" },
            },
          ])
        }
      >
        Добавить связь
      </Button>
    </div>
  );
}
