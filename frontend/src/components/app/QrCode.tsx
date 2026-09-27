import { useEffect, useRef } from "react";

import QRCodeStyling from "qr-code-styling";

import { cn } from "@/lib/utils";

/** QR рисуется во внутреннем высоком разрешении — иначе модули округляются. */
const RES = 1024;

/**
 * QR-код для сканирования телефоном: вход в корпоративный аккаунт мессенджера
 * («Каналы связи»). Тёмные модули на белом в обеих темах — сканеры спотыкаются
 * о тёмный код на тёмном фоне; стиль модулей — как у QR второго фактора
 * (`User/TwoFactorSetup`).
 */
const QrCode = ({
  data,
  size = 168,
  className,
}: {
  /** Строка кода — как пришла от сервера (`tg://login?token=…`). */
  data: string;
  size?: number;
  className?: string;
}) => {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || !data) return undefined;
    node.replaceChildren();
    const qr = new QRCodeStyling({
      width: RES,
      height: RES,
      type: "svg",
      data,
      margin: 0,
      qrOptions: { errorCorrectionLevel: "M" },
      backgroundOptions: { color: "#ffffff" },
      dotsOptions: { type: "rounded", color: "#14253a" },
      cornersSquareOptions: { type: "extra-rounded", color: "#14253a" },
      cornersDotOptions: { type: "dot", color: "#2a4a6e" },
    });
    qr.append(node);
    const svg = node.querySelector("svg");
    if (svg) {
      svg.setAttribute("viewBox", `0 0 ${RES} ${RES}`);
      svg.setAttribute("width", String(size));
      svg.setAttribute("height", String(size));
    }
    return () => node.replaceChildren();
  }, [data, size]);

  return (
    <div
      ref={ref}
      role="img"
      aria-label="QR-код для входа"
      className={cn("leading-none", className)}
      style={{ width: size, height: size }}
    />
  );
};

export default QrCode;
