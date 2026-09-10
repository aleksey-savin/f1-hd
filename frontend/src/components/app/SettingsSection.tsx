import type { ReactNode } from "react";

import {
  SectionMetaProvider,
  useIsSectionDirty,
} from "@/components/app/draft-context";
import { cn } from "@/lib/utils";

// Секция страницы настроек: uppercase-метка над панелью с тонкой границей
// (язык статус-борда: как ListGroupLabel, но метка живёт на канве, а не в
// панели). id — якорь для навигации-рейла; scroll-mt держит заголовок под
// fixed-навбаром при переходе по якорю. Читаемость меток при пользовательской
// фоновой картинке обеспечивает «лист» канвы в Root.jsx, не сама секция.
//
// Секция знает свои id и подпись, поэтому она же представляет себя черновику
// страницы (app/draft-context): обёртке секции их дублировать не нужно. Точка
// у метки означает несохранённые правки — тот же маркер стоит в рейле.
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
  const dirty = useIsSectionDirty(id);
  // Подпись раздела в плашке черновика — строка; у нестроковой метки её роль
  // берёт на себя id (такой секции на страницах настроек сейчас нет).
  const draftLabel = typeof label === "string" ? label : id;

  return (
    <section id={id} className={cn("scroll-mt-28", className)}>
      <div className="mb-2 flex items-center gap-2 px-1 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
        {label}
        {dirty && (
          <>
            <span
              aria-hidden="true"
              className="size-1.5 flex-none rounded-full bg-warning"
            />
            <span className="sr-only">не сохранено</span>
          </>
        )}
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <SectionMetaProvider id={id} label={draftLabel}>
          {children}
        </SectionMetaProvider>
      </div>
    </section>
  );
};

export default SettingsSection;
