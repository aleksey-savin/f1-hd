import { useEffect, useState } from "react";
import Field from "@/components/app/Field";
import { SubLabel } from "@/components/app/Panel";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import useToastStore from "@/store/toast-store";
import { failureText } from "@/components/Conversation/conversation-actions";
import {
  stickerUrl,
  type CorporateSticker,
} from "@/components/Conversation/StickerPicker";
type Pack = { name: string; title: string; url: string };
export default function CorporateStickers() {
  const [stickers, setStickers] = useState<CorporateSticker[]>([]);
  const [pack, setPack] = useState<Pack | null>(null);
  const [setUrl, setSetUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const reload = async () => {
    try {
      const data = await api<{
        stickers: CorporateSticker[];
        pack: Pack | null;
      }>("/api/settings/conversation-stickers");
      setStickers(data.stickers);
      setPack(data.pack);
      setSetUrl(data.pack?.url ?? "");
      setError(false);
    } catch {
      setError(true);
    }
  };
  useEffect(() => {
    void reload();
  }, []);
  const connect = async () => {
    setBusy(true);
    try {
      const result = await api<{ count: number }>(
        "/api/conversation-stickers/import",
        { method: "POST", body: { url: setUrl } },
      );
      await reload();
      useToastStore
        .getState()
        .showToast(
          "success",
          `Корпоративный набор подключён: ${result.count} стикеров`,
        );
    } catch (e) {
      useToastStore
        .getState()
        .showToast("danger", failureText(e, "Не удалось подключить набор"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="border-t border-border-soft px-5 py-4">
      <SubLabel>Корпоративные стикеры</SubLabel>
      <p className="mt-2 mb-3 text-sm text-muted-foreground">
        Один общий статичный набор Telegram для всех сотрудников. Новая ссылка
        заменяет текущий набор; отправленные стикеры остаются в истории.
      </p>
      <Field
        label="Ссылка на набор Telegram"
        htmlFor="corporate-sticker-set"
        className="mb-0"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id="corporate-sticker-set"
            value={setUrl}
            onChange={(event) => setSetUrl(event.target.value)}
            placeholder="https://t.me/addstickers/НазваниеНабора"
            disabled={busy}
            className="min-w-60 flex-1"
          />
          <Button
            type="button"
            variant="outline"
            disabled={busy || !setUrl.trim() || error}
            onClick={() => void connect()}
          >
            {busy
              ? "Загрузка…"
              : pack && setUrl.trim() === pack.url
                ? "Обновить набор"
                : "Подключить набор"}
          </Button>
        </div>
      </Field>
      <p className="mt-1.5 text-xs text-muted-foreground">
        Изменения применяются сразу после успешной загрузки. Чтобы получить
        новые стикеры из Telegram, обновите набор.
      </p>
      {error ? (
        <p className="text-sm text-destructive">
          Не удалось загрузить набор.{" "}
          <Button
            type="button"
            variant="link"
            size="xs"
            onClick={() => void reload()}
          >
            Повторить
          </Button>
        </p>
      ) : (
        <>
          {pack && (
            <p className="mt-3 text-sm font-medium">
              {pack.title} · {stickers.length} стикеров
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-3">
            {stickers.map((sticker) => (
              <span
                key={sticker.id}
                role="img"
                aria-label={sticker.label}
                title={sticker.label}
                className="block size-24 bg-contain bg-center bg-no-repeat"
                style={{
                  backgroundImage: `url("${stickerUrl(sticker.name)}")`,
                }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
