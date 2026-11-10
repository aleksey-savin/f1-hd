import { useCallback, useEffect, useState } from "react";
import { RiArrowRightLine, RiMailLine, RiQrCodeLine } from "react-icons/ri";

import HealthRow from "@/components/app/HealthRow";
import SettingRow from "@/components/app/SettingRow";
import { SubLabel } from "@/components/app/Panel";
import { ChannelIcon } from "@/components/Conversation/ChannelGlyph";
import { failureText } from "@/components/Conversation/conversation-actions";
import { Button } from "@/components/ui/button";
import useLiveTopic from "@/hooks/use-live-topic";
import { api } from "@/lib/api";
import useToastStore from "@/store/toast-store";
import type { MessagingChannel } from "@/types/conversation";
import { channelHealth, channelHint } from "@/util/channel-state";
import { formatAgo } from "@/util/format-date";

import TelegramChannelDialog from "./TelegramChannelDialog";
import Wazzup, { type WazzupSettings } from "./Wazzup";

// Wazzup сохраняется общим черновиком страницы; прямые каналы —
// мгновенными действиями существующего диалога входа.
type Prefs = {
  wazzup?: WazzupSettings;
  mailbox?: { address?: string };
  contacts?: { title?: string };
};

const telegramTile =
  "bg-channel-telegram-tint text-channel-telegram inset-ring-transparent";

const Channels = ({ prefs }: { prefs: Prefs }) => {
  const [channels, setChannels] = useState<MessagingChannel[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const reload = useCallback(async () => {
    try {
      const data = await api<{ channels: MessagingChannel[] }>("/api/channels");
      setChannels(data.channels);
      setLoadFailed(false);
    } catch (error) {
      console.warn("Каналы не загрузились:", error);
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useLiveTopic("channels", reload);

  const telegram = (channels ?? []).filter(
    (channel) => channel.type === "telegram" && channel.provider !== "wazzup",
  );
  const open = telegram.find((channel) => channel.id === openId) ?? null;

  // Канала ещё нет — заводим пустой и сразу открываем вход
  const connect = async () => {
    setCreating(true);
    try {
      const { channel } = await api<{ channel: MessagingChannel }>(
        "/api/channels",
        {
          method: "POST",
          body: { type: "telegram", name: "Telegram" },
        },
      );
      setChannels((current) => [...(current ?? []), channel]);
      setOpenId(channel.id);
    } catch (error) {
      useToastStore
        .getState()
        .showToast("danger", failureText(error, "Не удалось завести канал"));
    } finally {
      setCreating(false);
    }
  };

  const mailbox = prefs.mailbox?.address;

  return (
    <>
      <div className="px-5 py-4 text-sm text-muted-foreground">
        Сообщения всех подключённых аккаунтов поступают в «Диалоги», ответы
        отправляются оттуда же. Для разных аккаунтов можно использовать Wazzup и
        прямое подключение. Каждый аккаунт подключайте одним способом.
      </div>
      <Wazzup settings={prefs.wazzup} />
      <div className="border-t border-border px-5 pt-5 pb-1">
        <SubLabel>Прямое подключение</SubLabel>
        <p className="mt-2 mb-0 text-sm text-muted-foreground">
          Аккаунт подключается вручную в HD по QR-коду или коду входа. Здесь
          находятся ваши текущие подключения Telegram.
        </p>
      </div>
      {telegram.map((channel, index) => {
        const health = channelHealth(channel, {
          ago: (date) => formatAgo(date) ?? "",
        });
        return (
          <div key={channel.id}>
            <SettingRow
              title="Telegram — корпоративный аккаунт"
              hint={
                <>
                  <span className="block">
                    {channelHint(channel)} · напрямую
                  </span>
                  <span className="mt-1 block text-xs">
                    Вход и параметры аккаунта настраиваются в HD
                  </span>
                </>
              }
              leading={
                <ChannelIcon
                  network="telegram"
                  size={18}
                  className="text-inherit"
                />
              }
              leadingClassName={telegramTile}
              divider={index > 0}
            >
              <Button
                variant="outline"
                size="sm"
                className="max-md:w-full"
                onClick={() => setOpenId(channel.id)}
              >
                Настроить
              </Button>
            </SettingRow>
            <HealthRow
              state={health.state}
              title={health.title}
              meta={health.meta}
              hint={health.hint}
              action={
                health.action === "login" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setOpenId(channel.id)}
                  >
                    <RiQrCodeLine />
                    Показать QR
                  </Button>
                ) : undefined
              }
            />
          </div>
        );
      })}

      {channels !== null && telegram.length === 0 && (
        <>
          <SettingRow
            title="Telegram — корпоративный аккаунт"
            hint="Прямое подключение в HD. Клиенты пишут на корпоративный аккаунт, ответы уходят из Диалогов."
            leading={
              <ChannelIcon
                network="telegram"
                size={18}
                className="text-inherit"
              />
            }
            leadingClassName={telegramTile}
          >
            <Button
              variant="outline"
              size="sm"
              className="max-md:w-full"
              disabled={creating}
              onClick={() => void connect()}
            >
              Подключить
            </Button>
          </SettingRow>
          <HealthRow
            state="idle"
            title="Не подключён"
            hint="Войдите по QR-коду или коду из SMS"
          />
        </>
      )}

      {loadFailed && channels === null && (
        <HealthRow
          state="error"
          title="Каналы не загрузились"
          hint="Обновите страницу"
          className="border-t-0"
        />
      )}

      <SettingRow
        title="Почта"
        hint={
          mailbox
            ? `${mailbox} — настраивается в разделе «Сбор заявок»`
            : "Настраивается в разделе «Сбор заявок»"
        }
        leading={<RiMailLine size={18} />}
        divider={channels !== null}
      >
        <Button asChild variant="ghost" size="sm" className="max-md:w-full">
          <a href="#tickets-collect">
            Сбор заявок
            <RiArrowRightLine />
          </a>
        </Button>
      </SettingRow>

      <TelegramChannelDialog
        channel={open}
        onOpenChange={(next) => {
          if (!next) setOpenId(null);
        }}
        organization={prefs.contacts?.title ?? ""}
        onChanged={reload}
      />
    </>
  );
};

export default Channels;
