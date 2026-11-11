import { useEffect, useRef, useState } from "react";
import type { AnimationItem } from "lottie-web";
import type { MessageAttachment } from "@/types/conversation";
import { stickerFormat } from "@/util/sticker-media";
import { FileAttachment } from "./MessageMedia";

export default function StickerAttachment({
  attachment,
  kind,
  compact = false,
}: {
  attachment: MessageAttachment;
  kind: string;
  compact?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const format = stickerFormat(kind, attachment);
  const url = `${import.meta.env.VITE_API_ADDRESS ?? ""}/uploads/${attachment.name}`;
  const ready = attachment.status === "ready" && Boolean(attachment.name);
  useEffect(() => {
    if (!ready || format !== "tgs") return;
    const controller = new AbortController();
    let animation: AnimationItem | undefined;
    async function load() {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error("Sticker download failed");
        const blob = await response.blob();
        const data = await new Response(
          blob.stream().pipeThrough(new DecompressionStream("gzip")),
        ).json();
        const { default: lottie } = await import("lottie-web");
        if (controller.signal.aborted || !container.current) return;
        animation = lottie.loadAnimation({
          container: container.current,
          renderer: "svg",
          loop: true,
          autoplay: true,
          animationData: data,
        });
        animation.addEventListener("data_failed", () => setFailed(url));
      } catch {
        if (!controller.signal.aborted) setFailed(url);
      }
    }
    void load();
    return () => {
      controller.abort();
      animation?.destroy();
    };
  }, [ready, format, url]);
  if (!ready || failed === url || !format)
    return <FileAttachment attachment={attachment} kind="sticker" />;
  const box = compact ? "size-40" : "size-55";
  if (format === "tgs")
    return (
      <div
        ref={container}
        role="img"
        aria-label="Анимированный стикер"
        className={box}
      />
    );
  if (format === "video")
    return (
      <video
        src={url}
        autoPlay
        loop
        muted
        playsInline
        aria-label="Анимированный стикер"
        className={`${box} block object-contain`}
        onError={() => setFailed(url)}
      />
    );
  return (
    <div
      role="img"
      aria-label="Стикер"
      className={`${box} bg-contain bg-center bg-no-repeat`}
      style={{ backgroundImage: `url("${url}")` }}
    />
  );
}
