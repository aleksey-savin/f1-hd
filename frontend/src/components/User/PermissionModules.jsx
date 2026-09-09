import SwitchField from "@/components/app/SwitchField";
import { cn } from "@/lib/utils";

import { usePermissionCatalogue } from "@/store/authed-user";

/**
 * Якорь карточки группы. По нему ведёт рейл формы роли: секции рисуют себя
 * сами, а рейл собирается списком из того же каталога — как на карточке
 * компании.
 */
export const permissionGroupAnchor = (key) => `perm-group-${key}`;

/**
 * Матрица прав формы роли.
 *
 * Группы и подписи приходят с сервера (`/api/me` → `permissionCatalogue`):
 * список действий — свойство словаря, а не вёрстки, и второй его копии на
 * клиенте нет. Прежде здесь лежал собственный список из шести «модулей», и он
 * успел разойтись с сервером: право «Согласование отчётов по услугам» в него не
 * попало вовсе, поэтому выдать его из формы было нельзя ни одной роли.
 *
 * Мастер-переключателя у группы больше нет. Он изображал «рубильник модуля», а
 * на деле был обычным правом («видеть раздел») с особой ролью в вёрстке: снятая
 * галочка прятала соседние строки, и человек не видел, что у роли ещё есть.
 * Теперь «Видеть …» — такая же строка, как остальные, а рубильники модулей
 * живут там, где им место, — в настройках установки.
 *
 * Счётчик «N из M» работает НАВИГАЦИЕЙ: говорит, где у роли есть сила, до того
 * как человек начал читать строки.
 */
const PermissionModules = ({
  /** Набор выданных действий: Set или массив «ресурс.действие». */
  value,
  onToggle,
  /** Какие действия вообще можно трогать. Не передан — можно все. */
  allowed,
  /** Дополнительный блок под конкретным правом (категории у исполнителя). */
  renderExtra,
  className,
}) => {
  const groups = usePermissionCatalogue();
  const granted = value instanceof Set ? value : new Set(value || []);
  const allowedSet =
    allowed == null
      ? null
      : allowed instanceof Set
        ? allowed
        : new Set(allowed);

  const canToggle = (id) => !allowedSet || allowedSet.has(id);

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {groups.map((group) => {
        const count = group.actions.filter((action) =>
          granted.has(action.id),
        ).length;

        return (
          <div
            key={group.key}
            id={permissionGroupAnchor(group.key)}
            className="rounded-xl border border-border p-4"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">{group.label}</span>
              <span className="text-xs text-faint tabular-nums">
                {count} из {group.actions.length}
              </span>
            </div>

            {group.actions.map((action) => {
              const locked = !canToggle(action.id);
              return (
                <div key={action.id}>
                  <SwitchField
                    id={`perm-${action.id}`}
                    checked={granted.has(action.id)}
                    onCheckedChange={() => onToggle(action.id)}
                    disabled={locked}
                    label={
                      <span
                        className={cn(
                          "flex items-center gap-2",
                          locked && "text-muted-foreground",
                        )}
                      >
                        {action.label}
                        {/* Причина отказа стоит В СТРОКЕ, а не только в
                            подсказке: наведения на тач-экране нет. */}
                        {locked && (
                          <span className="text-xs text-faint">нет у вас</span>
                        )}
                      </span>
                    }
                    /* Пояснение к праву было написано, но не рисовалось нигде.
                       Именно здесь его и читают — в момент, когда решают,
                       выдавать право или нет. */
                    hint={action.hint || undefined}
                    className="py-2"
                  />
                  {renderExtra?.(action)}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
};

export default PermissionModules;
