import type { ReactNode } from "react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";

/**
 * «Контакт и действия» на телефоне — нижняя шторка поверх переписки (канва
 * B3): то же содержимое, что колонка справа на десктопе, крупнее под палец.
 */
const ContextSheet = ({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
}) => (
  <Sheet open={open} onOpenChange={onOpenChange}>
    <SheetContent
      side="bottom"
      className="max-h-[85dvh] gap-0 overflow-y-auto rounded-t-2xl border border-b-0 border-border p-5 pb-7"
    >
      <SheetTitle className="sr-only">{title}</SheetTitle>
      <SheetDescription className="sr-only">Контакт и действия</SheetDescription>
      {children}
    </SheetContent>
  </Sheet>
);

export default ContextSheet;
