import { useState } from "react";

import { Button } from "@/components/ui/button";
import QrCode from "@/components/app/QrCode";
import { Eyebrow, Panel } from "@/components/app/Panel";
import { fetchWireguardConfig, saveTextFile } from "@/store/mikrotik-changes";
import useToastStore from "@/store/toast-store";
import { formatDayMonthTime } from "@/util/format-date";

// Блок «Конфигурация для сотрудника» (после применения WireGuard-запроса):
// файл для приложения скачивается через авторизованную ручку, QR рисуется
// только по нажатию. Текст конфигурации (в нём приватный ключ) живёт в
// состоянии компонента и исчезает вместе с ним — ни в сторе, ни в localStorage.
const ChangeWireguard = ({ change }) => {
  const showToast = useToastStore((state) => state.showToast);
  const [busy, setBusy] = useState(null);
  const [qrText, setQrText] = useState(null);

  const wireguard = change.wireguard;
  const address = wireguard?.client?.address?.replace(/\/32$/, "");
  const allowed = wireguard?.client?.allowedIps || [];

  const run = async (kind, onText, via) => {
    setBusy(kind);
    try {
      onText(await fetchWireguardConfig(change._id, via));
    } catch (error) {
      showToast("danger", error.message || "Не удалось получить конфигурацию");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Eyebrow
        action={
          wireguard?.keysExpireAt && (
            <span className="text-xs text-faint">
              доступна до {formatDayMonthTime(wireguard.keysExpireAt)}
            </span>
          )
        }
      >
        Конфигурация для сотрудника
      </Eyebrow>
      <Panel>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          {qrText && (
            <div className="flex-none self-start rounded-lg border border-border bg-white p-2 sm:self-center">
              <QrCode
                data={qrText}
                size={200}
                ariaLabel="QR-код конфигурации WireGuard"
              />
            </div>
          )}
          <div className="flex min-w-0 flex-col gap-2.5">
            <p className="m-0 text-sm">
              Файл для приложения WireGuard на устройстве сотрудника.
              {address && ` Адрес в сети ${address}`}
              {address &&
                allowed.length > 0 &&
                `, доступ в ${allowed.join(", ")}`}
              {address && "."}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy !== null}
                onClick={() =>
                  run("file", (text) => saveTextFile(wireguard.fileName, text))
                }
              >
                Скачать {wireguard.fileName}
              </Button>
              {qrText ? (
                <Button variant="outline" onClick={() => setQrText(null)}>
                  Скрыть QR-код
                </Button>
              ) : (
                <Button
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => run("qr", setQrText, "qr")}
                >
                  Показать QR-код
                </Button>
              )}
            </div>
            <span className="text-xs text-faint">
              Приватный ключ хранится сутки, затем стирается. Скачать могут
              заявитель и утвердившие.
            </span>
          </div>
        </div>
      </Panel>
    </>
  );
};

export default ChangeWireguard;
