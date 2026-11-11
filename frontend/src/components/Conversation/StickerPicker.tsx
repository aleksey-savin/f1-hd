import { useState } from "react";
import { RiEmotionHappyLine } from "react-icons/ri";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { api } from "@/lib/api";
export type CorporateSticker = { id: string; label: string; name: string };
export const stickerUrl = (name: string) =>
  `${import.meta.env.VITE_API_ADDRESS ?? ""}/uploads/${name}`;
export default function StickerPicker({
  onSend,
  disabled,
  phone,
  catalogueUrl = "/api/conversation-stickers",
}: {
  onSend: (id: string) => Promise<void>;
  disabled: boolean;
  phone: boolean;
  catalogueUrl?: string;
}) {
  const [open, setOpen] = useState(false);
  const [stickers, setStickers] = useState<CorporateSticker[] | null>(null);
  const [error, setError] = useState(false);
  const change = async (value: boolean) => {
    setOpen(value);
    if (value) {
      setError(false);
      setStickers(null);
      try {
        const data = await api<{ stickers: CorporateSticker[] }>(catalogueUrl);
        setStickers(data.stickers);
      } catch {
        setError(true);
      }
    }
  };
  return (
    <Popover open={open} onOpenChange={(value) => void change(value)}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant={phone ? "ghost" : "outline"}
          size={phone ? "icon-lg" : "xs"}
          aria-label="Стикеры"
          disabled={disabled}
        >
          <RiEmotionHappyLine />
          {!phone && "Стикеры"}
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-72 p-3">
        <div className="mb-2 text-sm font-semibold">Стикеры</div>
        {error ? (
          <div className="text-sm text-muted-foreground">
            Не удалось загрузить набор.{" "}
            <Button
              type="button"
              variant="link"
              size="xs"
              onClick={() => void change(true)}
            >
              Повторить
            </Button>
          </div>
        ) : stickers === null ? (
          <p className="text-sm text-muted-foreground">Загрузка…</p>
        ) : stickers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Корпоративный набор пока пуст.
          </p>
        ) : (
          <div className="grid max-h-80 grid-cols-3 gap-1 overflow-auto">
            {stickers.map((sticker) => (
              <button
                key={sticker.id}
                type="button"
                title={sticker.label}
                aria-label={`Отправить стикер «${sticker.label}»`}
                disabled={disabled}
                onClick={() => {
                  void onSend(sticker.id)
                    .then(() => setOpen(false))
                    .catch(() => {});
                }}
                className="size-20 cursor-pointer rounded-lg border-0 bg-transparent p-1 hover:bg-accent focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
              >
                <span
                  role="img"
                  aria-label={sticker.label}
                  className="block size-full bg-contain bg-center bg-no-repeat"
                  style={{
                    backgroundImage: `url("${stickerUrl(sticker.name)}")`,
                  }}
                />
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
