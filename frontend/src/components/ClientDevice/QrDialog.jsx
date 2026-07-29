import { isMobile } from "react-device-detect";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

import DeviceQr from "./DeviceQr";

// Код — крупный: его сканируют прямо с экрана, а не разглядывают. Мелкий
// (легаси показывал 76 px постоянно в каждой карточке списка) телефон берёт
// неохотно, а соседние коды попадают в кадр.
const QR_SIZE = 216;

const QrCard = ({ device }) => (
  <div className="tw:text-center">
    <div className="tw:flex tw:justify-center">
      <DeviceQr id={device._id} size={QR_SIZE} />
    </div>
    <div className="tw:mt-2.5 tw:font-mono tw:text-base tw:font-semibold tw:tracking-wide">
      {device.inventoryNumber || (
        <span className="tw:font-sans tw:text-sm tw:font-normal tw:text-faint">
          Инвентарный номер не присвоен
        </span>
      )}
    </div>
    <div className="tw:truncate tw:text-sm tw:text-muted-foreground">
      {device.name}
      {device.company?.name ? ` · ${device.company.name}` : ""}
    </div>
  </div>
);

/**
 * QR-код устройства: десктоп — диалог по центру экрана, мобайл — нижний лист
 * (там центр экрана занят кодом целиком).
 *
 * Открытием управляет вызывающий: входов несколько (кнопка «QR-код», иконка в
 * гнезде строки, сама инвентарная метка), поэтому состояние снаружи. `children`
 * — необязательный триггер, он просто рендерится рядом.
 */
const QrDialog = ({ device, open, onOpenChange, children = null }) => {
  if (!device) return children;

  if (isMobile) {
    return (
      <>
        {children}
        <Sheet open={open} onOpenChange={onOpenChange}>
          <SheetContent side="bottom" className="tw:pb-8">
            <SheetTitle className="tw:sr-only">QR-код устройства</SheetTitle>
            <div className="tw:px-5 tw:pt-6">
              <QrCard device={device} />
            </div>
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <>
      {children}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="tw:sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>QR-код</DialogTitle>
            <DialogDescription>
              Код ведёт на карточку устройства.
            </DialogDescription>
          </DialogHeader>
          <QrCard device={device} />
        </DialogContent>
      </Dialog>
    </>
  );
};

export default QrDialog;
