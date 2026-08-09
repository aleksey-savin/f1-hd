import SwitchField from "@/components/app/SwitchField";
import { cn } from "@/lib/utils";

import { PERMISSION_MODULES } from "./permissions-catalog";

/**
 * Матрица прав — ОДИН компонент на форму человека и форму роли.
 *
 * Раньше он жил внутри `UserForm` функцией `moduleBlock`, и форма роли завела
 * себе вторую версию на голых чекбоксах: один и тот же список прав читался
 * двумя разными способами. Копий у этой матрицы быть не должно — набор прав и
 * так живёт в трёх местах (схема, словарь, каталог подписей), и четвёртое
 * расхождение было бы в вёрстке.
 *
 * Карточка модуля: заголовок · счётчик «N из M» · мастер-свитч справа.
 * Счётчик здесь работает НАВИГАЦИЕЙ: он говорит, где у роли есть сила, до
 * того как человек начал читать строки. Выключенный модуль сворачивается
 * целиком — четыре погашенные строки не несут информации.
 */
const PermissionModules = ({
  values,
  onToggle,
  /** Какие права вообще можно трогать. Не передан — можно все. */
  allowed,
  /** Дополнительный блок под конкретным правом (категории у исполнителя). */
  renderExtra,
  className,
}) => {
  const canToggle = (key) => !allowed || Boolean(allowed[key]);

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {PERMISSION_MODULES.map((module) => {
        const master = module.master;
        const off = master ? !values[master] : false;
        const granted = module.caps.filter((cap) => values[cap.key]).length;

        return (
          <div
            key={module.key}
            className={cn(
              "rounded-xl border border-border p-4",
              off && "opacity-60",
            )}
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">{module.label}</span>
              <span className="text-xs text-faint tabular-nums">
                {off ? "выключен" : `${granted} из ${module.caps.length}`}
              </span>
              {master && (
                <span className="ms-auto">
                  <SwitchField
                    id={`perm-master-${module.key}`}
                    checked={!!values[master]}
                    onCheckedChange={() => onToggle(master)}
                    disabled={!canToggle(master)}
                    label="Модуль"
                    className="py-0"
                  />
                </span>
              )}
            </div>

            {!off &&
              module.caps.map((cap) => {
                const locked = !canToggle(cap.key);
                return (
                  <div key={cap.key}>
                    <SwitchField
                      id={`perm-${cap.key}`}
                      checked={!!values[cap.key]}
                      onCheckedChange={() => onToggle(cap.key)}
                      disabled={locked}
                      label={
                        <span
                          className={cn(
                            "flex items-center gap-2",
                            locked && "text-muted-foreground",
                          )}
                        >
                          {cap.label}
                          {/* Причина отказа стоит В СТРОКЕ, а не только в
                              подсказке: наведения на тач-экране нет. */}
                          {locked && (
                            <span className="text-xs text-faint">нет у вас</span>
                          )}
                        </span>
                      }
                      className="py-2"
                    />
                    {renderExtra?.(cap)}
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
