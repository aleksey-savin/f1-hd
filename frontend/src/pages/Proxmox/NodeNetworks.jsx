import { useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useFormSheet } from "@/components/app/FormOutlet";
import { FormHeader, FormActions } from "@/components/app/FormLayout";
import Field from "@/components/app/Field";
import Combobox from "@/components/app/Combobox";
import AlertMessage from "@/components/app/AlertMessage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { linksPayload, rankedRouters, routerRows } from "./node-network-state";

const endpoint = (id) => `/api/proxmox/nodes/${id}/network-links`;
export const nodeNetworksLoader = ({ params, request }) =>
  api(endpoint(params.id), { signal: request.signal });
export async function nodeNetworksAction({ params, request }) {
  try {
    return await api(endpoint(params.id), {
      method: "PUT",
      body: await request.json(),
    });
  } catch (error) {
    return {
      error: true,
      message:
        error.status === 409
          ? "Связи изменены другим пользователем. Ваши изменения сохранены в форме. Откройте форму заново, чтобы получить актуальные связи."
          : error.message,
    };
  }
}

export default function NodeNetworks() {
  const data = useLoaderData();
  const fetcher = useFetcher();
  const { close } = useFormSheet();
  // Keep the loaded revision and links throughout edits, including failed saves.
  const [initial] = useState(data);
  const routers = rankedRouters(initial.routers);
  const [selected, setSelected] = useState(routers[0]?.id || "");
  const [drafts, setDrafts] = useState(() =>
    routers[0]
      ? {
          [routers[0].id]: routerRows(
            initial.networks,
            routers[0],
            initial.links,
          ),
        }
      : {},
  );
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(false);
  const matchingRouters = routers.filter((entry) =>
    `${entry.name} ${entry.address}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const visibleRouters =
    search || expanded
      ? matchingRouters
      : routers.filter((entry, index) => index < 3 || entry.id === selected);
  const [options, setOptions] = useState({});
  const [optionsError, setOptionsError] = useState("");
  const busy = fetcher.state !== "idle";
  const router = routers.find((entry) => entry.id === selected);
  const rows = drafts[selected] || [];
  const payload = linksPayload(initial.links, drafts);
  const incomplete = payload.some((link) => !link.cidr || !link.lanInterface);
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok)
      close("..", { replace: true });
  }, [fetcher.state, fetcher.data, close]);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    setOptionsError("");
    api(
      `${endpoint(initial.node.id)}/options?routerId=${encodeURIComponent(selected)}`,
      { signal: controller.signal },
    )
      .then((value) => {
        if (controller.signal.aborted) return;
        setOptions((current) => ({ ...current, [selected]: value }));
      })
      .catch((error) => {
        if (!controller.signal.aborted) setOptionsError(error.message);
      });
    return () => controller.abort();
  }, [selected, initial.node.id]);
  const select = (entry) => {
    setSelected(entry.id);
    setDrafts((current) =>
      Object.hasOwn(current, entry.id)
        ? current
        : {
            ...current,
            [entry.id]: routerRows(initial.networks, entry, initial.links),
          },
    );
  };
  const update = (index, change) =>
    setDrafts((current) => ({
      ...current,
      [selected]: current[selected].map((row, i) =>
        i === index ? { ...row, ...change } : row,
      ),
    }));
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!incomplete && !busy)
          fetcher.submit(
            { revision: initial.revision, links: payload },
            { method: "post", encType: "application/json" },
          );
      }}
    >
      <FormHeader
        title="Связать с сетевым устройством"
        subtitle={initial.node.name}
      />
      <p className="my-4 text-sm text-muted-foreground">
        Выберите устройство. Совпадающие сети узла будут предложены для связи.
      </p>
      <Field label="Поиск сетевого устройства" htmlFor="node-router-search">
        <Input
          id="node-router-search"
          placeholder="Название или адрес"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </Field>
      <h2 className="mb-3 text-base font-semibold">Сетевое устройство</h2>
      <div className="space-y-2" aria-label="Сетевое устройство">
        {visibleRouters.map((entry) => {
          const count = new Set(entry.matches.map((match) => match.networkKey))
            .size;
          const saved = payload.filter(
            (link) => link.routerId === entry.id,
          ).length;
          return (
            <button
              key={entry.id}
              type="button"
              disabled={busy}
              aria-pressed={selected === entry.id}
              onClick={() => select(entry)}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl border p-4 text-left focus-visible:outline-2 focus-visible:outline-ring",
                count ? "border-primary/30 bg-primary/5" : "border-border-soft",
                selected === entry.id && "border-primary ring-1 ring-primary",
              )}
            >
              <span aria-hidden className="text-accent-text">
                {selected === entry.id ? "●" : "○"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block break-words text-sm font-medium">
                  {entry.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  MikroTik · {entry.address || "Адрес не указан"}
                  {` · Выбрано связей: ${saved}`}
                </span>
              </span>
              <span
                className={cn(
                  "text-xs",
                  count ? "text-accent-text" : "text-muted-foreground",
                )}
              >
                {count ? `Совпадает сетей: ${count}` : "Нет совпадений"}
              </span>
            </button>
          );
        })}
        {!matchingRouters.length && (
          <p className="text-sm text-muted-foreground">
            {routers.length
              ? "Устройства не найдены."
              : "Нет доступных сетевых устройств."}
          </p>
        )}
      </div>
      {!search && routers.length > 3 && (
        <Button
          type="button"
          variant="ghost"
          className="mt-2"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded
            ? "Свернуть список"
            : `Показать все устройства (${routers.length})`}
        </Button>
      )}
      {router && (
        <section className="mt-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">Соответствия сетей</h2>
            <span className="text-xs text-muted-foreground">
              Выбрано: {rows.filter((row) => row.selected).length} из{" "}
              {rows.length}
            </span>
          </div>
          <p className="mt-1 mb-3 text-sm text-muted-foreground">
            Однозначные совпадения отмечены. Снимите отметку, если сеть не нужно
            связывать.
          </p>
          {rows.map((row, index) => {
            const ambiguous = row.ambiguous;
            const choices = [
              ...new Set(
                [
                  ...row.candidates,
                  ...(options[selected]?.interfaces || []).map(
                    (entry) => entry.value,
                  ),
                  row.lanInterface,
                ].filter(Boolean),
              ),
            ].map((name) => ({ value: name, label: name }));
            return (
              <div
                key={`${row.network.key}:${row._id || index}`}
                className={cn(
                  "grid grid-cols-[20px_minmax(0,1fr)] items-center gap-3 border-t border-border-soft py-4 sm:grid-cols-[20px_minmax(0,1fr)_20px_minmax(0,1fr)]",
                  ambiguous && "bg-accent/40",
                )}
              >
                <Checkbox
                  aria-label={`Связать ${row.bridge} ${row.vlan ?? "без VLAN"} ${row.cidr || "без подсети"}`}
                  disabled={busy || !row.cidr}
                  checked={row.selected}
                  onCheckedChange={(checked) =>
                    update(index, { selected: checked === true })
                  }
                />
                <div className="min-w-0 text-sm">
                  <strong className="font-medium">
                    {row.cidr || "Подсеть не определена"}
                  </strong>
                  <div>
                    {row.bridge} ·{" "}
                    {row.vlan == null ? "Без VLAN" : `VLAN ${row.vlan}`}
                  </div>
                  <div className="break-words text-xs text-muted-foreground">
                    {Array.isArray(row.network.physical)
                      ? row.network.physical.join(" · ")
                      : row.network.physical ||
                        "Физический интерфейс не определён"}
                  </div>
                </div>
                <span
                  className="hidden text-muted-foreground sm:block"
                  aria-hidden
                >
                  →
                </span>
                <div className="col-start-2 min-w-0 sm:col-start-auto">
                  {ambiguous && (
                    <p className="mb-1 text-xs text-muted-foreground">
                      Совпадение неоднозначно — выберите интерфейс вручную
                    </p>
                  )}
                  {!ambiguous &&
                  row.candidates.length === 1 &&
                  row.lanInterface === row.candidates[0] ? (
                    <>
                      <span className="text-sm font-medium">
                        {row.lanInterface}
                      </span>
                      <p className="text-xs text-accent-text">
                        Совпадает подсеть
                      </p>
                    </>
                  ) : row.selected || ambiguous || row._id ? (
                    <Combobox
                      ariaLabel={`Интерфейс для ${row.bridge} ${row.vlan ?? "без VLAN"} ${row.cidr}`}
                      value={row.lanInterface}
                      options={choices}
                      disabled={busy}
                      placeholder="Не связывать — требуется выбор"
                      onChange={(value) =>
                        update(index, {
                          lanInterface: value || "",
                          selected: Boolean(value),
                        })
                      }
                    />
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      Нет совпадения · останется без связи
                    </span>
                  )}
                </div>
              </div>
            );
          })}
          {!rows.length && (
            <p className="text-sm text-muted-foreground">
              Сети узла не обнаружены.
            </p>
          )}
          {(optionsError || router.error) && (
            <AlertMessage
              variant="danger"
              message={optionsError || router.error}
            />
          )}
        </section>
      )}
      <p className="mt-4 text-sm text-muted-foreground">
        Остальные сети можно связать с другим устройством. Без связи проверка не
        выполняется, предупреждение в ВМ не показывается.
      </p>
      {initial.warnings.map((warning, index) => (
        <p key={index} className="mt-2 text-sm text-muted-foreground">
          {warning}
        </p>
      ))}
      {fetcher.data?.error && (
        <AlertMessage variant="danger" message={fetcher.data.message} />
      )}
      {incomplete && (
        <p className="mt-3 text-sm text-muted-foreground">
          Выберите соответствие для каждой отмеченной сети.
        </p>
      )}
      <p className="mt-3 text-sm text-muted-foreground" role="status">
        Всего выбрано связей: {payload.length} · Устройств:{" "}
        {new Set(payload.map((link) => link.routerId)).size}. Сохраняются связи
        всех выбранных устройств.
      </p>
      <FormActions>
        <Button type="button" variant="ghost" onClick={close} disabled={busy}>
          Отмена
        </Button>
        <Button className="ml-auto" type="submit" disabled={busy || incomplete}>
          {busy ? "Сохранение…" : "Сохранить"}
        </Button>
      </FormActions>
    </form>
  );
}
