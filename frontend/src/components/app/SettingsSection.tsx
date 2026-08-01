import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// Секция страницы настроек: uppercase-метка над панелью с тонкой границей
// (язык статус-борда: как ListGroupLabel, но метка живёт на канве, а не в
// панели). id — якорь для навигации-рейла; scroll-mt держит заголовок под
// fixed-навбаром при переходе по якорю. Читаемость меток при пользовательской
// фоновой картинке обеспечивает «лист» канвы в Root.jsx, не сама секция.
const SettingsSection = ({
  id,
  label,
  className,
  children,
}: {
  id: string;
  label: ReactNode;
  className?: string;
  children: ReactNode;
}) => {
  return (
    <section id={id} className={cn("scroll-mt-28", className)}>
      <div className="mb-2 px-1 text-sm font-semibold tracking-widest text-muted-foreground uppercase">
        {label}
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {children}
      </div>
    </section>
  );
};

export default SettingsSection;
