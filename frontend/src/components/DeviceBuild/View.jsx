import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";

import {
  RiCpuLine,
  RiDeleteBinLine,
  RiEdit2Line,
  RiMoreLine,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import Crumbs, { useCrumbFrom } from "@/components/app/Crumbs";
import { Eyebrow, Panel } from "@/components/app/Panel";
import FormOutlet from "@/components/app/FormOutlet";
import { DeleteDialog } from "@/components/app/DeleteItem";
import SpecSheet from "@/components/app/SpecSheet";
import KeySpecChips from "@/components/app/KeySpecChips";
import {
  buildAssemblyGroups,
  buildKeySpecs,
  buildPartRows,
  liveAssembly,
} from "@/components/app/assembly-specs";
import { plural } from "../../util/plural";
import { useCan } from "@/store/authed-user";

// Карточка своей сборки (макет «Своя сборка ПК», разд. 3): шапка с ключевыми
// характеристиками, «Конфигурация» — детали по слотам со ссылками на модели,
// «Характеристики» — значения конфигураций деталей по группам атрибутов.

const ViewDeviceBuild = ({ build = {}, deviceType = null, partLinks = {} }) => {
  const location = useLocation();
  const can = useCan();
  const canManage = can({ inventoryCatalog: ["manage"] });
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Карточку открываем от начала (Root сбрасывает лишь мобильный контейнер)
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const name = build.name || "Без названия";
  // Как сборка назовётся в крошке карточки модели детали
  const fromState = useCrumbFrom(name);
  const parts = build.parts || [];
  const { slots, keySpecs } = liveAssembly(deviceType?.assembly);
  const typeId = deviceType?._id || build.deviceTypeId;
  const typeName = deviceType?.name || "Тип удалён";
  const typePath = `/inventory/device-types/${typeId}`;

  // Деталей — штук: «2 × память» — две детали
  const units = parts.reduce(
    (sum, part) => sum + (part.quantity > 0 ? part.quantity : 1),
    0,
  );
  const keys = buildKeySpecs(keySpecs, parts, slots);
  const partRows = buildPartRows(slots, parts);
  const specGroups = buildAssemblyGroups(parts, partLinks);

  // «Конфигурация» — тот же вид строк, что у характеристик: тип → модель
  const configGroups = [
    {
      key: "parts",
      name: "Комплектующие",
      rows: partRows.map((row) => ({
        id: row.key,
        label: row.label,
        value: (
          <>
            {row.quantity > 1 && `${row.quantity} × `}
            {row.modelId ? (
              <Link
                to={`/inventory/device-models/${row.modelId}`}
                state={fromState}
                className="font-medium text-accent-text no-underline hover:underline"
              >
                {row.title}
              </Link>
            ) : (
              <span className="text-muted-foreground">{row.title}</span>
            )}
          </>
        ),
      })),
    },
  ];

  // Крошки: «‹ Типы устройств › <тип> › Сборка». Пришли с карточки типа —
  // она и есть первая крошка, второй раз тип не повторяем
  const from = location.state?.from;
  const fromType = from?.to?.split("?")[0] === typePath;
  const chain = [
    ...(fromType || !deviceType ? [] : [{ label: typeName, to: typePath }]),
    { label: "Сборка" },
  ];

  const bold = (n) => <b className="font-semibold text-foreground">{n}</b>;
  const sep = <span className="text-faint">·</span>;

  return (
    <div className="mx-auto w-full max-w-4xl">
      <Crumbs section="device-types" chain={chain} />

      {/* Hero */}
      <div className="flex flex-wrap items-start gap-4">
        {/* Плитка hero — глиф, не монограмма */}
        <span
          aria-hidden
          className="grid size-12 flex-none place-items-center rounded-xl bg-accent text-muted-foreground sm:size-14 sm:rounded-2xl"
        >
          <RiCpuLine size={26} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="my-0 text-xl leading-tight font-semibold tracking-tight break-words sm:text-2xl">
            {name}
          </h1>
          <div className="mt-2 text-sm text-muted-foreground tabular-nums">
            Своя сборка {sep} {typeName} {sep} {bold(units)}{" "}
            {plural(units, "деталь", "детали", "деталей")}
          </div>
          <KeySpecChips entries={keys} />
        </div>
        {canManage && (
          <div className="flex w-full flex-none items-center gap-2 sm:w-auto">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Действия"
                  title="Действия"
                >
                  <RiMoreLine />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => setDeleteOpen(true)}
                >
                  <RiDeleteBinLine /> Удалить
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {/* Телефон: ряд действий во всю ширину, «Изменить» тянется */}
            <Button asChild className="flex-1 sm:flex-none">
              {/* Правка — вложенный маршрут карточки: остаёмся на ней.
                  state (откуда пришли) едет в шторку и возвращается после
                  сохранения — крошки не теряют источник */}
              <Link to="update" state={location.state}>
                <RiEdit2Line /> Изменить
              </Link>
            </Button>
          </div>
        )}
      </div>

      {/* Конфигурация — детали по слотам, ссылками на модели */}
      <Eyebrow count={units}>Конфигурация</Eyebrow>
      <Panel>
        {partRows.length === 0 ? (
          <p className="my-0 text-sm text-muted-foreground">Деталей нет</p>
        ) : (
          <SpecSheet groups={configGroups} />
        )}
      </Panel>

      {/* Характеристики — из конфигураций моделей деталей */}
      <Eyebrow>Характеристики</Eyebrow>
      <Panel>
        {specGroups.length === 0 ? (
          <p className="my-0 text-sm text-muted-foreground">
            Без характеристик
          </p>
        ) : (
          <SpecSheet groups={specGroups} />
        )}
      </Panel>

      {build.notes && (
        <>
          <Eyebrow>Примечание</Eyebrow>
          <Panel>
            <p className="my-0 text-sm leading-relaxed break-words whitespace-pre-line">
              {build.notes}
            </p>
          </Panel>
        </>
      )}

      {/* Удаление (из «⋯» героя) — вне radix-меню, по состоянию */}
      <DeleteDialog
        item={{ _id: build._id, title: name }}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        customDeleteMessage="Сборка пропадёт из списка сборок типа."
      />

      {/* Правка сборки — нижняя шторка прямо на карточке */}
      <FormOutlet />
    </div>
  );
};

export default ViewDeviceBuild;
