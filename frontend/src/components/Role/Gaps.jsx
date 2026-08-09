import {
  CLIENT_PERMISSIONS,
  PERMISSION_MODULES,
} from "@/components/User/permissions-catalog";

/**
 * Права, которых не даёт ни одна роль, кроме полного доступа.
 *
 * Смысл блока — показать дыры каталога: пока право сюда попадает, выдать его
 * можно только вместе со всем порталом. Правило считает сервер («роль отдаёт
 * весь словарь» — там же, где им зеркалится isAdmin), здесь только вёрстка.
 *
 * Пустой список означает, что каталог закрыт полностью, — тогда блока нет
 * вовсе: панель с нулём была бы шумом под каждым списком ролей.
 */

/** Ключ → раздел и подпись. Каталог прав один на проект. */
const CATALOGUE = [
  ...PERMISSION_MODULES.flatMap((module) => [
    ...(module.master
      ? [{ key: module.master, group: module.label, label: "Доступ к разделу" }]
      : []),
    ...module.caps.map((cap) => ({
      key: cap.key,
      group: module.label,
      label: cap.label,
    })),
  ]),
  // Клиентские права в модули не входят: они правятся своим коротким списком
  // в форме человека, а не матрицей.
  ...CLIENT_PERMISSIONS.map((cap) => ({
    key: cap.key,
    group: "Клиентское",
    label: cap.label,
  })),
];

const RoleGaps = ({ gaps = [] }) => {
  if (!gaps.length) return null;

  const wanted = new Set(gaps);
  const rows = CATALOGUE.filter(
    (item, index) =>
      wanted.has(item.key) &&
      // Право может значиться и в модуле, и в клиентском списке — показываем
      // один раз, по первому вхождению.
      CATALOGUE.findIndex((other) => other.key === item.key) === index,
  );
  if (!rows.length) return null;

  const groups = [];
  for (const row of rows) {
    const existing = groups.find((group) => group.title === row.group);
    if (existing) existing.items.push(row);
    else groups.push({ title: row.group, items: [row] });
  }

  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-dashed border-border">
      <div className="border-b border-border-soft px-4 py-3">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold">Права без своей роли</span>
          <span className="tabular-nums text-faint">{gaps.length}</span>
        </div>
        <p className="mt-1 mb-0 text-sm text-muted-foreground">
          Право попадает сюда, когда его не даёт ни одна роль, кроме роли с
          полным доступом. Выдать его отдельно сейчас не получится — заведите
          роль.
        </p>
      </div>

      {groups.map((group) => (
        <div key={group.title}>
          <div className="px-4 pt-3 pb-1 text-xs font-semibold tracking-wider text-faint uppercase">
            {group.title}
          </div>
          {group.items.map((item) => (
            <div
              key={item.key}
              className="flex items-center gap-3 px-4 py-1.5 text-[15px]"
            >
              <span className="min-w-0 truncate">{item.label}</span>
              <span className="ml-auto shrink-0 text-xs text-faint">
                только полный доступ
              </span>
            </div>
          ))}
        </div>
      ))}
      <div className="h-3" />
    </div>
  );
};

export default RoleGaps;
