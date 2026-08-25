import { usePermissionCatalogue } from "@/store/authed-user";

/**
 * «Что получается» — итог выбранных ролей в форме человека.
 *
 * Роль выбирают, а отвечают за права: складывать два-три набора в уме никто не
 * должен, и до этого блока приходилось. Справа от каждого права стоит роль,
 * которая его дала, — это ответ на вопрос «почему у него это есть», ради
 * которого сегодня открывают по очереди все роли человека.
 *
 * Матрицы галочек здесь больше нет: она переехала в форму роли целиком.
 */

/**
 * Права выбранных ролей и источник каждого.
 *
 * `allActions` — весь словарь (приезжает с сервера): по нему опознаётся роль
 * полного доступа. Перечислять её права незачем — «можно всё» короче и честнее
 * полусотни строк.
 */
export const effectiveOf = (keys = [], catalogue = [], allActions = []) => {
  const chosen = keys
    .map((key) => catalogue.find((role) => role.key === key))
    .filter(Boolean);

  const sources = {};
  for (const role of chosen) {
    for (const id of role.actions || []) {
      (sources[id] ||= []).push(role.title);
    }
  }

  const grantsEverything = (role) => {
    const granted = new Set(role?.actions || []);
    return allActions.length > 0 && allActions.every((id) => granted.has(id));
  };

  return {
    sources,
    granted: Object.keys(sources),
    full: chosen.find(grantsEverything) || null,
  };
};

/**
 * Опции селектора ролей: сначала подходящие типу аккаунта, следом остальные.
 *
 * Чужой адресат не запрещён — он уходит вниз отдельной группой. Данные
 * дрейфуют, и жёсткий запрет однажды окажется тупиком; заказчику, которому
 * действительно нужна роль сотрудника, придётся её выбрать.
 */
export const rolesToOptions = (catalogue = [], kind) => {
  const wanted = kind === "client" ? "client" : "staff";
  const heading = {
    client: { own: "Для клиентов", other: "Роли сотрудников" },
    staff: { own: "Для сотрудников", other: "Роли клиентов" },
  }[wanted];

  const byAudience = (audience) =>
    catalogue
      .filter((role) => (role.audience || "staff") === audience)
      .sort((a, b) => (b.usage?.total || 0) - (a.usage?.total || 0))
      .map((role) => ({
        value: role.key,
        label: role.title,
        group: audience === wanted ? heading.own : heading.other,
        hint: role.description || undefined,
      }));

  return [
    ...byAudience(wanted),
    ...byAudience(wanted === "client" ? "staff" : "client"),
  ];
};

/** Разделы с тем, что в них открыто. Пустой раздел не показываем вовсе. */
const groupsOf = (permissionGroups, granted) => {
  const has = new Set(granted);
  return permissionGroups
    .map((group) => ({
      title: group.label,
      caps: group.actions.filter((action) => has.has(action.id)),
    }))
    .filter((group) => group.caps.length);
};

const RoleSummary = ({ roles, catalogue, emptyHint }) => {
  const permissionGroups = usePermissionCatalogue();
  const allActions = permissionGroups.flatMap((group) =>
    group.actions.map((action) => action.id),
  );
  const { sources, granted, full } = effectiveOf(roles, catalogue, allActions);

  if (full) {
    return (
      <div className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm">
        <span className="font-semibold">Полный доступ ко всему порталу.</span>{" "}
        Перечислять права незачем — роль «{full.title}» даёт всё, включая то,
        что появится позже. Остальные роли ничего не добавят.
      </div>
    );
  }

  const groups = groupsOf(permissionGroups, granted);

  if (!groups.length) {
    return (
      <div className="rounded-xl border border-border px-3 py-3 text-sm text-muted-foreground">
        {emptyHint}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="flex items-baseline gap-2 border-b border-border bg-accent/55 px-3 py-2.5">
        <span className="text-sm font-semibold">Что получается</span>
        <span className="ml-auto text-sm tabular-nums text-faint">
          {granted.length} из {allActions.length}
        </span>
      </div>

      {groups.map((group) => (
        <div key={group.title}>
          <div className="px-3 pt-2.5 pb-1 text-xs font-semibold tracking-wider text-faint uppercase">
            {group.title}
          </div>
          {group.caps.map((cap) => (
            <div
              key={cap.id}
              className="flex items-center gap-2.5 px-3 py-1 text-[15px]"
            >
              <span className="shrink-0 font-bold text-accent-text">✓</span>
              <span className="min-w-0 truncate">{cap.label}</span>
              <span className="ml-auto shrink-0 truncate rounded-full bg-accent px-2 py-0.5 text-xs text-muted-foreground">
                {sources[cap.id]?.join(", ")}
              </span>
            </div>
          ))}
        </div>
      ))}
      <div className="h-2.5" />
    </div>
  );
};

export default RoleSummary;
