import { useMemo, useState } from "react";
import { useLoaderData } from "react-router";

import {
  RiAddLine,
  RiCloseLine,
  RiEdit2Line,
  RiSearchLine,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import FormWrapper from "@/components/app/FormWrapper";
import { FormHeader } from "@/components/app/FormLayout";
import { cn } from "@/lib/utils";

import DeviceAttributeFormFields from "../DeviceAttribute/FormFields";
import { valueTypeLabel } from "../DeviceAttribute/value-types";
import { plural } from "../../util/plural";
import useToastStore from "../../store/toast-store";

// Шторка «Добавить атрибуты» с карточки типа (макет согласован 19.10):
// отметить несколько атрибутов каталога и создать недостающие прямо из поиска.
// Цифра в отметке — очередь: в этом порядке атрибуты встанут в конец списка
// типа. Новые попадают в каталог только по «Добавить» — одним запросом вместе
// с привязкой. Флаги «Обязательный»/«Расширяемый» здесь не задаются: всё
// добавляется с выключенными, правка — ⋯ → Изменить (AttributeForm).

const SELECT_TYPES = ["select", "multiselect"];
const sameName = (name) => String(name || "").trim().toLocaleLowerCase("ru");

const atomsLabel = (n) => plural(n, "атрибут", "атрибута", "атрибутов");

// Пустая карточка нового атрибута: тот же объект, что ждёт
// DeviceAttributeFormFields в `attribute` (там же он и правится)
const blankDraft = (name) => ({
  name,
  valueType: "string",
  unit: "",
  options: [],
  isActive: true,
});

// Отметка с номером очереди
const Box = ({ index, disabled }) => (
  <span
    aria-hidden
    className={cn(
      "mt-px grid size-5 flex-none place-items-center rounded-md border-[1.5px] text-xs font-bold text-white tabular-nums",
      index >= 0
        ? "border-primary bg-primary"
        : disabled
          ? "border-border bg-accent"
          : "border-border bg-background",
    )}
  >
    {index >= 0 ? index + 1 : null}
  </span>
);

const Pill = ({ muted, children }) => (
  <span
    className={cn(
      "ml-1.5 inline-block rounded-full px-2 py-px align-[1px] text-xs font-semibold",
      muted ? "bg-accent text-muted-foreground" : "bg-primary/15 text-accent-text",
    )}
  >
    {children}
  </span>
);

const GroupLabel = ({ children, count }) => (
  <div className="pt-3.5 pb-1.5 text-xs font-bold tracking-wider text-faint uppercase">
    {children}
    <span className="font-semibold tracking-normal tabular-nums">
      {" "}
      · {count}
    </span>
  </div>
);

// Строка атрибута: вся строка — переключатель отметки
const AttrRow = ({ attr, index, attached, onToggle, onEdit }) => {
  const options = SELECT_TYPES.includes(attr.valueType)
    ? (attr.options || []).map((option) => option.label || option.value)
    : [];
  return (
    <li className="-mx-2 flex items-start gap-1">
      <button
        type="button"
        role="checkbox"
        aria-checked={index >= 0}
        disabled={attached}
        onClick={() => onToggle(attr._id)}
        className={cn(
          "flex min-w-0 flex-1 cursor-pointer items-start gap-3 rounded-lg border-0 bg-transparent px-2 py-2 text-left text-inherit hover:bg-accent",
          attached && "cursor-default opacity-60 hover:bg-transparent",
        )}
      >
        <Box index={index} disabled={attached} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">
            {attr.name}
            {attr.unit && (
              <span className="font-normal text-faint"> ({attr.unit})</span>
            )}
            {attr.isNew && <Pill>новый</Pill>}
            {attached && <Pill muted>уже у типа</Pill>}
          </span>
          {options.length > 0 && (
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {options.join(" · ")}
            </span>
          )}
        </span>
        <span className="mt-px flex-none text-sm text-muted-foreground">
          {valueTypeLabel(attr.valueType)}
        </span>
      </button>
      {attr.isNew && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Изменить новый атрибут"
          title="Изменить"
          className="mt-1 mr-2 flex-none text-faint"
          onClick={() => onEdit(attr._id)}
        >
          <RiEdit2Line />
        </Button>
      )}
    </li>
  );
};

const AttributesAddForm = () => {
  const loaderData = useLoaderData();
  const deviceType = loaderData?.deviceType; // { _id, name }
  const catalog = loaderData?.availableAttributes || [];
  const usedIds = useMemo(
    () => new Set(loaderData?.usedAttributeIds || []),
    [loaderData],
  );
  const { showToast } = useToastStore();

  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState([]); // id в порядке отметок
  const [fresh, setFresh] = useState([]); // новые: { _id: "new-N", isNew, ... }
  const [draft, setDraft] = useState(null); // { attribute, editId, key }
  const [draftError, setDraftError] = useState("");

  const all = useMemo(() => [...catalog, ...fresh], [catalog, fresh]);
  const q = sameName(query);
  const hit = (attr) => !q || sameName(attr.name).includes(q);

  const editId = draft?.editId;
  const freshShown = fresh.filter((attr) => attr._id !== editId && hit(attr));
  const catalogShown = catalog
    .filter((attr) => !usedIds.has(String(attr._id)) && hit(attr))
    .sort((a, b) => (a.name || "").localeCompare(b.name || "", "ru"));
  // Уже привязанные — только в поиске, приглушённо: видно, что дубль не нужен
  const attachedShown = q
    ? catalog.filter((attr) => usedIds.has(String(attr._id)) && hit(attr))
    : [];
  const exactExists = all.some((attr) => sameName(attr.name) === q);
  const canCreate = !!q && !exactExists && !draft;

  const toggle = (id) =>
    setPicked((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  const openCreate = () => {
    setDraftError("");
    setDraft({
      attribute: blankDraft(query.trim()),
      editId: null,
      key: Date.now(),
    });
  };

  const openEdit = (id) => {
    const attr = fresh.find((item) => item._id === id);
    if (!attr) return;
    setDraftError("");
    setDraft({ attribute: { ...attr }, editId: id, key: Date.now() });
  };

  // onChange общих полей: options приходят текстом (вариант на строку)
  const onDraftChange = (data) =>
    setDraft((prev) => ({
      ...prev,
      attribute: {
        ...prev.attribute,
        name: data.name,
        valueType: data.valueType,
        unit: data.unit,
        isActive: data.isActive,
        options: String(data.options || "")
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((value) => ({ value, label: value })),
      },
    }));

  const closeDraft = () => {
    setDraft(null);
    setDraftError("");
  };

  // «Убрать» у правимого нового — снять его из очереди совсем
  const dropDraft = () => {
    if (draft?.editId) {
      setFresh((prev) => prev.filter((attr) => attr._id !== draft.editId));
      setPicked((prev) => prev.filter((id) => id !== draft.editId));
    }
    closeDraft();
  };

  const commitDraft = () => {
    const attr = draft.attribute;
    const name = attr.name.trim();
    if (!name) {
      setDraftError("Укажите наименование.");
      return;
    }
    const clash = all.find(
      (item) => item._id !== draft.editId && sameName(item.name) === sameName(name),
    );
    if (clash) {
      setDraftError(
        clash.isNew
          ? `Атрибут «${clash.name}» уже создаётся здесь.`
          : `Атрибут «${clash.name}» уже есть в каталоге — отметьте его в списке.`,
      );
      return;
    }
    if (SELECT_TYPES.includes(attr.valueType) && !attr.options.length) {
      setDraftError("Добавьте варианты выбора.");
      return;
    }
    const next = {
      ...attr,
      name,
      unit: (attr.unit || "").trim(),
      options: SELECT_TYPES.includes(attr.valueType) ? attr.options : [],
    };
    if (draft.editId) {
      setFresh((prev) =>
        prev.map((item) =>
          item._id === draft.editId ? { ...next, _id: item._id, isNew: true } : item,
        ),
      );
    } else {
      const id = `new-${Date.now()}`;
      setFresh((prev) => [...prev, { ...next, _id: id, isNew: true }]);
      setPicked((prev) => [...prev, id]);
      setQuery("");
    }
    closeDraft();
  };

  const count = picked.length;
  const newCount = picked.filter((id) =>
    fresh.some((attr) => attr._id === id),
  ).length;

  const note = (
    <>
      {newCount > 0 && (
        <b className="font-semibold text-muted-foreground">
          {newCount}{" "}
          {plural(newCount, "новый попадёт", "новых попадут", "новых попадут")}{" "}
          в каталог.{" "}
        </b>
      )}
      Обязательность и расширяемость — потом, через ⋯ → Изменить.
    </>
  );

  const buildBody = () => ({
    items: picked.map((id) => {
      const attr = fresh.find((item) => item._id === id);
      if (!attr) return { attributeId: id };
      const { name, valueType, unit, options, isActive } = attr;
      return { attribute: { name, valueType, unit, options, isActive } };
    }),
  });

  // Enter в поиске не отправляет форму: создаёт атрибут, если его нет
  const onSearchKeyDown = (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (canCreate) openCreate();
  };

  const nothingFound =
    !!q && !freshShown.length && !catalogShown.length && !attachedShown.length;

  return (
    <FormWrapper
      title="Добавить атрибуты"
      header={
        <FormHeader
          title="Добавить атрибуты"
          subtitle={deviceType?.name ? `Тип: ${deviceType.name}` : null}
        >
          {/* Не app/SearchBar: тот — своя <form>, а здесь мы уже внутри формы */}
          <div className="relative">
            <RiSearchLine
              size={16}
              aria-hidden
              className="absolute top-1/2 left-3 -translate-y-1/2 text-faint"
            />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onSearchKeyDown}
              placeholder="Найти или создать атрибут"
              aria-label="Найти или создать атрибут"
              autoComplete="off"
              className="pr-9 pl-9 text-sm"
            />
            {query && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Очистить"
                onClick={() => setQuery("")}
                className="absolute top-1/2 right-1 -translate-y-1/2 text-faint"
              >
                <RiCloseLine />
              </Button>
            )}
          </div>
        </FormHeader>
      }
      json={buildBody}
      submitLabel={
        count ? `Добавить ${count} ${atomsLabel(count)}` : "Добавить атрибуты"
      }
      submitDisabled={count === 0 || !!draft}
      actionsNote={note}
      onSuccess={() =>
        showToast(
          "success",
          `${plural(count, "Добавлен", "Добавлено", "Добавлено")} ${count} ${atomsLabel(count)}`,
        )
      }
      successTo={`/inventory/device-types/${deviceType?._id}`}
    >
      {draft && (
        <div className="my-2.5 rounded-xl border border-border p-4 pb-3 ring-3 ring-primary/10">
          <div className="mb-2.5 text-sm font-semibold text-muted-foreground">
            {draft.editId ? "Новый атрибут" : "Новый атрибут в каталоге"}
          </div>
          <DeviceAttributeFormFields
            key={draft.key}
            attribute={draft.attribute}
            onChange={onDraftChange}
          />
          {draftError && (
            <p className="mt-2 mb-0 text-sm text-destructive">{draftError}</p>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={draft.editId ? dropDraft : closeDraft}
            >
              {draft.editId ? "Убрать" : "Отмена"}
            </Button>
            <Button type="button" size="sm" onClick={commitDraft}>
              {draft.editId ? "Готово" : "Создать и отметить"}
            </Button>
          </div>
        </div>
      )}

      {freshShown.length > 0 && (
        <>
          <GroupLabel count={fresh.length}>Новые</GroupLabel>
          <ul className="m-0 list-none p-0">
            {freshShown.map((attr) => (
              <AttrRow
                key={attr._id}
                attr={attr}
                index={picked.indexOf(attr._id)}
                onToggle={toggle}
                onEdit={openEdit}
              />
            ))}
          </ul>
        </>
      )}

      {(!q || catalogShown.length > 0 || attachedShown.length > 0) && (
        <>
          <GroupLabel count={catalogShown.length}>
            {q ? "Найдено в каталоге" : "Каталог"}
          </GroupLabel>
          <ul className="m-0 list-none p-0">
            {catalogShown.map((attr) => (
              <AttrRow
                key={attr._id}
                attr={attr}
                index={picked.indexOf(attr._id)}
                onToggle={toggle}
              />
            ))}
            {attachedShown.map((attr) => (
              <AttrRow key={attr._id} attr={attr} index={-1} attached />
            ))}
          </ul>
          {!q && catalogShown.length === 0 && (
            <p className="mt-1 mb-0 text-sm text-muted-foreground">
              Все атрибуты каталога уже у типа. Новый создаётся из поиска.
            </p>
          )}
        </>
      )}

      {nothingFound && !draft && (
        <p className="mt-3 mb-0 text-sm text-muted-foreground">
          В каталоге такого атрибута нет.
        </p>
      )}

      {canCreate && (
        <button
          type="button"
          onClick={openCreate}
          className="-mx-2 mt-0.5 flex w-[calc(100%+1rem)] cursor-pointer items-center gap-3 rounded-lg border-0 bg-transparent px-2 py-2 text-left text-sm font-semibold text-accent-text hover:bg-accent"
        >
          <span className="grid size-5 flex-none place-items-center rounded-md border-[1.5px] border-dashed border-current">
            <RiAddLine size={14} />
          </span>
          Новый атрибут «{query.trim()}»
        </button>
      )}

      {/* Пояснение у кнопок — на десктопе (actionsNote), на телефоне — здесь */}
      <p className="mt-4 mb-0 text-xs text-faint sm:hidden">{note}</p>
    </FormWrapper>
  );
};

export default AttributesAddForm;
