import type { IconType } from "react-icons";
import {
  RiChat3Line,
  RiGlobalLine,
  RiGroupLine,
  RiMailLine,
  RiMessage3Line,
  RiPhoneLine,
  RiTelegram2Line,
  RiWhatsappLine,
} from "react-icons/ri";

import { cn } from "@/lib/utils";

/**
 * Глиф канала «Диалогов». Цвет — фирменный у мессенджеров (решение владельца
 * 24.09, спека «Channel brand colours»): Telegram, WhatsApp, MAX; форма сайта,
 * почта и телефон — нейтральные. Токены — `--channel-*` в styles/tailwind.css,
 * обе темы.
 */
export type ChannelKey =
  | "telegram"
  | "whatsapp"
  | "max"
  | "site"
  | "mail"
  | "phone"
  | "group";

const ICONS: Record<ChannelKey, IconType> = {
  telegram: RiTelegram2Line,
  whatsapp: RiWhatsappLine,
  // У MAX нет значка в наборе Remix — пузырь сообщения
  max: RiMessage3Line,
  site: RiGlobalLine,
  mail: RiMailLine,
  phone: RiPhoneLine,
  group: RiGroupLine,
};

const BRAND_TEXT: Partial<Record<ChannelKey, string>> = {
  telegram: "text-channel-telegram",
  whatsapp: "text-channel-whatsapp",
  max: "text-channel-max",
};

const BRAND_TILE: Partial<Record<ChannelKey, string>> = {
  telegram: "bg-channel-telegram-tint text-channel-telegram",
  whatsapp: "bg-channel-whatsapp-tint text-channel-whatsapp",
  max: "bg-channel-max-tint text-channel-max",
};

/** Фирменный цвет текста глифа; у нейтральных каналов — пусто (цвет наследуется). */
export const channelTextClass = (key: string): string =>
  BRAND_TEXT[key as ChannelKey] ?? "";

/** Есть ли у канала фирменный цвет. */
export const isBrandChannel = (key: string): boolean =>
  Boolean(BRAND_TILE[key as ChannelKey]);

/** Глиф канала фирменным цветом (метки хроники, шапка диалога, меню ответа). */
export const ChannelIcon = ({
  network,
  size = 16,
  className,
}: {
  network: string;
  size?: number;
  className?: string;
}) => {
  const Icon = ICONS[network as ChannelKey] ?? RiChat3Line;
  return (
    <Icon
      size={size}
      aria-hidden
      className={cn("flex-none", channelTextClass(network), className)}
    />
  );
};

/**
 * Плитка канала: фирменная подложка у мессенджеров, `neutralClassName` — у
 * остальных (строка списка — `bg-accent text-muted-foreground`, строка
 * контакта — `bg-primary/15 text-accent-text`). Размер и скругление — через
 * `className`.
 */
export const ChannelTile = ({
  network,
  iconSize = 20,
  neutralClassName = "bg-accent text-muted-foreground",
  className,
}: {
  network: string;
  iconSize?: number;
  neutralClassName?: string;
  className?: string;
}) => {
  const Icon = ICONS[network as ChannelKey] ?? RiChat3Line;
  return (
    <span
      aria-hidden
      className={cn(
        "grid flex-none place-items-center",
        BRAND_TILE[network as ChannelKey] ?? neutralClassName,
        className,
      )}
    >
      <Icon size={iconSize} />
    </span>
  );
};
