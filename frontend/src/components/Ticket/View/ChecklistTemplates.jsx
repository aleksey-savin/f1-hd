import { useEffect, useState } from "react";

import {
  RiBuildingLine,
  RiCheckLine,
  RiListCheck2,
  RiPriceTag3Line,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { plural } from "../../../util/plural";
import { dismissOffer, isOfferDismissed } from "../../../util/checklist-offer";

/**
 * Шаблоны чек-листов в заявке: строка источника с «Ещё чек-листы», предложка
 * при выключенном автоприменении и подтверждение смены.
 *
 * Ранжирование («побеждает самый узкий») считает сервер —
 * `services/checklistTemplates`. Второй копии правила на клиенте нет: она
 * разъехалась бы с первой на первом же краевом случае.
 */

export const useChecklistTemplates = (ticketNum, canEdit) => {
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!canEdit) return;
    let alive = true;

    (async () => {
      try {
        const response = await fetch(
          `${import.meta.env.VITE_API_ADDRESS}/api/checklist-templates/for-ticket/${ticketNum}`,
        );
        if (!response.ok) return;
        const json = await response.json();
        if (alive) setData(json);
      } catch (error) {
        console.error("Не удалось получить шаблоны чек-листов:", error);
      }
    })();

    return () => {
      alive = false;
    };
  }, [ticketNum, canEdit]);

  return data;
};

const Bind = ({ icon: Icon, children, dashed = false }) => (
  <span
    className={cn(
      "inline-flex items-center gap-1 rounded-md border border-border-soft px-1.5 py-0.5 text-xs text-muted-foreground",
      dashed ? "border-dashed" : "bg-secondary",
    )}
  >
    {Icon && <Icon size={11} className="text-faint" />}
    {children}
  </span>
);

const TemplateOption = ({ template, active, onPick }) => (
  <button
    type="button"
    onClick={() => onPick(template)}
    className={cn(
      "flex w-full cursor-pointer appearance-none items-start gap-2.5 rounded-lg border-0 bg-transparent px-2.5 py-2 text-left hover:bg-accent",
      active && "bg-accent",
    )}
  >
    <span className="min-w-0 flex-1">
      <span className="block text-sm font-medium">{template.title}</span>
      <span className="mt-1 flex flex-wrap gap-1.5">
        {(template.categories || []).map((category) => (
          <Bind key={category._id ?? category} icon={RiPriceTag3Line}>
            {category.title ?? "категория"}
          </Bind>
        ))}
        {(template.companies || []).map((company) => (
          <Bind key={company._id ?? company} icon={RiBuildingLine}>
            {company.alias ?? "компания"}
          </Bind>
        ))}
        {(template.categories?.length ?? 0) === 0 &&
          (template.companies?.length ?? 0) === 0 && (
            <Bind dashed>без привязок</Bind>
          )}
      </span>
    </span>
    <span className="flex-none text-xs text-faint tabular-nums">
      {template.items?.length ?? 0}
    </span>
    {active && <RiCheckLine className="flex-none text-accent-text" size={15} />}
  </button>
);

/**
 * «Ещё чек-листы» — поповер выбора. Два раздела, а не один список: «подходят
 * этой заявке» — те, что сработали бы автоматически, «остальные» — шаблоны с
 * чужими привязками и без них, которые всё равно иногда нужны. Смешать их
 * значит потерять смысл автоподбора.
 */
export const TemplatePicker = ({
  templates,
  currentTitle,
  hasChecks,
  onApply,
  onClear,
  trigger,
}) => {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(null);

  const matched = templates?.matched ?? [];
  const others = templates?.others ?? [];
  const total = matched.length + others.length;

  if (total === 0) return null;

  const pick = (template) => {
    setOpen(false);
    // Пока ничего не отмечено — меняем молча; отметки исчезают вместе с
    // пунктами, и об этом говорим до, а не после
    if (hasChecks) return setPending(template);
    onApply(template);
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen} modal={false}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent align="start" className="w-96 p-1.5">
          {matched.length > 0 && (
            <>
              <p className="m-0 px-2.5 pt-2 pb-1.5 text-xs font-semibold tracking-wide text-faint uppercase">
                Подходят этой заявке
              </p>
              {matched.map((template) => (
                <TemplateOption
                  key={template._id}
                  template={template}
                  active={template.title === currentTitle}
                  onPick={pick}
                />
              ))}
            </>
          )}

          {others.length > 0 && (
            <>
              <p className="m-0 mt-1 border-t border-border-soft px-2.5 pt-2.5 pb-1.5 text-xs font-semibold tracking-wide text-faint uppercase">
                Остальные
              </p>
              {others.map((template) => (
                <TemplateOption
                  key={template._id}
                  template={template}
                  active={template.title === currentTitle}
                  onPick={pick}
                />
              ))}
            </>
          )}

          {onClear && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onClear();
              }}
              className="mt-1 flex w-full cursor-pointer appearance-none border-0 border-t border-border-soft bg-transparent px-2.5 py-2.5 text-left text-sm text-muted-foreground hover:text-foreground"
            >
              Убрать чек-лист
            </button>
          )}
        </PopoverContent>
      </Popover>

      <Dialog open={Boolean(pending)} onOpenChange={() => setPending(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Сменить чек-лист на «{pending?.title}»?</DialogTitle>
          </DialogHeader>
          <p className="m-0 text-sm text-muted-foreground">
            Совпадающие по названию пункты сохранят отметки. Остальные
            отмеченные пункты исчезнут вместе с тем, кто и когда их выполнил.
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Отмена
            </Button>
            <Button
              onClick={() => {
                onApply(pending);
                setPending(null);
              }}
            >
              Сменить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

/**
 * Предложение применить шаблон, когда автоприменение выключено.
 *
 * Живёт НА МЕСТЕ секции чек-листа — там, где список и появится, — а не
 * баннером над описанием: наверху оно оказывалось на одной линии с темой
 * заявки и отжимало вниз то, ради чего карточку открыли.
 *
 * Тон нейтральный, а не акцентный: это подсказка, а не событие, требующее
 * решения. Отказ переживает перезагрузку (util/checklist-offer) — иначе строка
 * всплывала бы снова на каждое обновление страницы.
 */
export const TemplateOffer = ({ ticketNum, templates, onApply }) => {
  const [dismissed, setDismissed] = useState(() => isOfferDismissed(ticketNum));
  const best = templates?.matched?.[0];

  if (!best || dismissed || templates?.autoApply) return null;

  const rest = (templates.matched?.length ?? 0) - 1;
  const basis = best.categories?.[0]?.title
    ? `по категории «${best.categories[0].title}»`
    : best.companies?.[0]?.alias
      ? `по компании «${best.companies[0].alias}»`
      : null;

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
      <span className="grid size-7 flex-none place-items-center rounded-lg bg-primary/10 text-accent-text">
        <RiListCheck2 size={15} />
      </span>
      <span className="min-w-0 flex-1">
        <p className="m-0 text-sm text-muted-foreground">
          Есть чек-лист{" "}
          <span className="font-medium text-foreground">«{best.title}»</span>
        </p>
        <p className="mt-0.5 mb-0 text-xs text-faint">
          {best.items?.length ?? 0}{" "}
          {plural(best.items?.length ?? 0, "пункт", "пункта", "пунктов")}
          {basis ? ` · ${basis}` : ""}
          {rest > 0 && ` · ещё ${rest} подходит`}
        </p>
      </span>
      <span className="flex flex-none gap-1.5">
        <Button
          variant="ghost"
          size="xs"
          onClick={() => {
            dismissOffer(ticketNum);
            setDismissed(true);
          }}
        >
          Скрыть
        </Button>
        <Button variant="outline" size="xs" onClick={() => onApply(best)}>
          Применить
        </Button>
      </span>
    </div>
  );
};
