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
  <div className="text-center">
    <div className="flex justify-center">
      <DeviceQr id={device._id} size={QR_SIZE} />
    </div>
    <div className="mt-2.5 font-mono text-base font-semibold tracking-wide">
      {device.inventoryNumber || (
        <span className="font-sans text-sm font-normal text-faint">
          Инвентарный номер не присвоен
        </span>
      )}
    </div>
    <div className="truncate text-sm text-muted-foreground">
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
          <SheetContent side="bottom" className="pb-8">
            <SheetTitle className="sr-only">QR-код устройства</SheetTitle>
            <div className="px-5 pt-6">
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
        <DialogContent className="sm:max-w-xs">
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
