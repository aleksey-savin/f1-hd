import { useState } from "react";
import { isMobile } from "react-device-detect";
import { RiArrowDownSLine, RiCheckLine, RiMailLine } from "react-icons/ri";

import {
  ChannelIcon,
  ChannelTile,
} from "@/components/Conversation/ChannelGlyph";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { DeliveryRoute, DeliveryRoutes } from "@/types/conversation";
import {
  NOTIFY_ROUTE,
  routeSubtitle,
  routeTitle,
  routeTriggerLabel,
} from "@/util/delivery-routes";

/**
 * «Ответить через» в поле комментария заявки (канва D1 — меню, D3 — шторка
 * телефона): чаты заявителя и «Почта и бот HD — как сейчас». Занятый другой
 * заявкой чат виден, но погашен — с причиной. Выбор отправляет комментарий в
 * мессенджер (`deliverVia`), заявитель тогда не получает дубль письмом.
 */

type Option = {
  value: string;
  network: string;
  title: string;
  subtitle: string;
  disabled: boolean;
};

const optionsOf = (data: DeliveryRoutes): Option[] => [
  ...data.routes.map((route: DeliveryRoute) => ({
    value: route.conversationId,
    network: route.network,
    title: routeTitle(route, data.applicantName),
    subtitle: routeSubtitle(route),
    disabled: !route.available,
  })),
  {
    value: NOTIFY_ROUTE,
    network: "mail",
    title: "Почта и бот HD",
    subtitle: "как сейчас — уведомление о комментарии",
    disabled: false,
  },
];

const Item = ({
  option,
  selected,
  big,
  onPick,
}: {
  option: Option;
  selected: boolean;
  big: boolean;
  onPick: (value: string) => void;
}) => (
  <button
    type="button"
    role="radio"
    aria-checked={selected}
    disabled={option.disabled}
    onClick={() => onPick(option.value)}
    className={cn(
      "flex w-full cursor-pointer appearance-none rounded-md border-0 text-left text-foreground outline-none focus-visible:ring-4 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-45",
      big ? "items-center gap-3 bg-transparent px-1 py-2.5" : "items-start gap-2.5 p-2 hover:bg-accent",
      !big && selected && "bg-accent",
    )}
  >
    {big ? (
      <ChannelTile
        network={option.network}
        iconSize={18}
        className="size-9 rounded-lg"
      />
    ) : option.network === "mail" ? (
      <RiMailLine size={16} aria-hidden className="mt-0.5 flex-none text-muted-foreground" />
    ) : (
      <ChannelIcon network={option.network} size={16} className="mt-0.5" />
    )}
    <span className="min-w-0 flex-1">
      <span className={cn("block", big ? "text-base leading-6" : "text-sm")}>
        {option.title}
      </span>
      <span className="block text-xs text-muted-foreground">{option.subtitle}</span>
    </span>
    {big ? (
      <span
        aria-hidden
        className={cn(
          "size-5 flex-none rounded-full",
          selected ? "border-6 border-primary" : "border-[1.5px] border-faint",
        )}
      />
    ) : (
      <span className="mt-0.5 flex w-4 flex-none text-accent-text">
        {selected && <RiCheckLine size={16} aria-hidden />}
      </span>
    )}
  </button>
);

const List = ({
  data,
  value,
  big,
  onPick,
}: {
  data: DeliveryRoutes;
  value: string;
  big: boolean;
  onPick: (value: string) => void;
}) => {
  const options = optionsOf(data);
  const notify = options[options.length - 1];
  return (
    <div role="radiogroup" aria-label="Канал ответа" className="flex flex-col">
      {options.slice(0, -1).map((option) => (
        <Item key={option.value} option={option} selected={value === option.value} big={big} onPick={onPick} />
      ))}
      <div aria-hidden className={cn("h-px bg-border-soft", big ? "my-1.5" : "-mx-1 my-1")} />
      <Item option={notify} selected={value === notify.value} big={big} onPick={onPick} />
    </div>
  );
};

const ReplyRoute = ({
  data,
  value,
  onChange,
}: {
  data: DeliveryRoutes;
  value: string;
  onChange: (value: string) => void;
}) => {
  const [open, setOpen] = useState(false);
  const route = data.routes.find((item) => item.conversationId === value) ?? null;
  const pick = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  const trigger = (
    <button
      type="button"
      aria-haspopup="true"
      aria-expanded={open}
      aria-label={`Ответить через: ${routeTriggerLabel(route, data.applicantName)}`}
      onClick={isMobile ? () => setOpen(true) : undefined}
      className={cn(
        "inline-flex min-w-0 flex-none cursor-pointer appearance-none items-center gap-1.5 rounded-lg border bg-card px-2.5 text-xs font-semibold whitespace-nowrap text-foreground outline-none focus-visible:ring-4 focus-visible:ring-ring/50",
        isMobile ? "h-9" : "h-8",
        open ? "border-primary" : "border-border",
      )}
    >
      {route ? (
        <ChannelIcon network={route.network} size={14} />
      ) : (
        <RiMailLine size={14} aria-hidden className="flex-none text-muted-foreground" />
      )}
      <span className="truncate">{routeTriggerLabel(route, data.applicantName)}</span>
      <RiArrowDownSLine size={14} aria-hidden className="flex-none text-muted-foreground" />
    </button>
  );

  if (isMobile) {
    return (
      <>
        {trigger}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent
            side="bottom"
            className="max-h-[85dvh] gap-0 overflow-y-auto rounded-t-2xl border border-b-0 border-border px-4 pt-4.5 pb-6"
          >
            <SheetTitle className="px-1 pb-2 text-lg font-semibold">Ответить через</SheetTitle>
            <SheetDescription className="sr-only">Канал ответа клиенту</SheetDescription>
            <List data={data} value={value} big onPick={pick} />
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className="w-76 p-1">
        <div className="px-2 pt-1.5 pb-1 text-xs font-semibold text-faint">Ответить через</div>
        <List data={data} value={value} big={false} onPick={pick} />
      </PopoverContent>
    </Popover>
  );
};

export default ReplyRoute;
