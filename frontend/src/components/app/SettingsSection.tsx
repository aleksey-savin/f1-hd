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
    <section id={id} className={cn("tw:scroll-mt-28", className)}>
      <div className="tw:mb-2 tw:px-1 tw:text-sm tw:font-semibold tw:tracking-widest tw:text-muted-foreground tw:uppercase">
        {label}
      </div>
      <div className="tw:overflow-hidden tw:rounded-xl tw:border tw:border-border tw:bg-card">
        {children}
      </div>
    </section>
  );
};

export default SettingsSection;
