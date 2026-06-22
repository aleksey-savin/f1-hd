import { useEffect, useRef } from "react";
import QRCodeStyling from "qr-code-styling";

// Стилизованный QR со ссылкой на страницу устройства в HD: для печати наклейки и
// быстрого перехода сканированием. Скруглённые модули + фирменный градиент +
// скруглённые «глаза»; тёмные тона на белом фоне — красиво и стабильно
// сканируется в любой теме. Ссылка строится от текущего origin → ведёт на тот же
// хост HD, где открыт интерфейс.
//
// Рендерим во внутреннем высоком разрешении и масштабируем SVG через viewBox под
// нужный размер: иначе при маленьком размере qr-code-styling округляет модуль до
// 1px и центрирует код с большими белыми полями. Уровень коррекции M — меньше
// модулей, крупнее точки, лучше читается.
const RES = 1024;

const buildOptions = (url) => ({
  width: RES,
  height: RES,
  type: "svg",
  data: url,
  margin: 0,
  qrOptions: { errorCorrectionLevel: "M" },
  backgroundOptions: { color: "#ffffff" },
  dotsOptions: {
    type: "rounded",
    gradient: {
      type: "linear",
      rotation: 0.78,
      colorStops: [
        { offset: 0, color: "#2a4a6e" },
        { offset: 1, color: "#14253a" },
      ],
    },
  },
  cornersSquareOptions: { type: "extra-rounded", color: "#14253a" },
  cornersDotOptions: { type: "dot", color: "#2a4a6e" },
});

const DeviceQr = ({ id, size = 72, className = "" }) => {
  const ref = useRef(null);

  const url =
    id && typeof window !== "undefined"
      ? `${window.location.origin}/inventory/client-devices/${id}`
      : null;

  useEffect(() => {
    const node = ref.current;
    if (!url || !node) return;

    const qr = new QRCodeStyling(buildOptions(url));
    node.innerHTML = "";
    qr.append(node);

    // Делаем SVG адаптивным — заполняет контейнер любого размера без лишних полей.
    const svg = node.querySelector("svg");
    if (svg) {
      svg.setAttribute("viewBox", `0 0 ${RES} ${RES}`);
      svg.setAttribute("width", "100%");
      svg.setAttribute("height", "100%");
      svg.style.display = "block";
    }

    return () => {
      node.innerHTML = "";
    };
  }, [url]);

  if (!url) return null;

  return (
    <span
      className={`bg-white rounded p-1 d-inline-flex flex-shrink-0 ${className}`}
      title="QR на страницу устройства"
    >
      <span style={{ width: size, height: size, lineHeight: 0 }} ref={ref} />
    </span>
  );
};

export default DeviceQr;
