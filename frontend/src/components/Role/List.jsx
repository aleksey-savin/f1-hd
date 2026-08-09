import ListRow from "@/components/app/ListRow";

import { PERMISSION_MODULES } from "@/components/User/permissions-catalog";

/**
 * Строки каталога ролей.
 *
 * Мета читается слева направо как ответ на два вопроса подряд: «сколько
 * человек» (единственное, с чем сюда приходят) и «в каких разделах роль вообще
 * что-то может». Перечислять двадцать девять прав в строке нельзя — их
 * подробности живут в правке.
 */

/** Разделы, в которых роль хоть что-то даёт. */
const groupsOf = (permissions = {}) =>
  PERMISSION_MODULES.filter((module) =>
    [module.master, ...module.caps.map((cap) => cap.key)]
      .filter(Boolean)
      .some((key) => permissions[key]),
  ).map((module) => module.label);

const peopleWord = (count) => {
  const tail = count % 10;
  const teen = count % 100 >= 11 && count % 100 <= 14;
  if (!teen && tail === 1) return "человек";
  if (!teen && tail >= 2 && tail <= 4) return "человека";
  return "человек";
};

const RoleList = ({ roles }) => (
  <>
    {roles.map((role) => {
      const total = role.usage?.total || 0;
      const groups = groupsOf(role.permissions);

      return (
        <ListRow
          key={role.key}
          // ListRow ждёт сущность с `_id`: ключ роли и есть её идентификатор.
          item={{ _id: role.key, title: role.title, updatedAt: role.updatedAt }}
          itemTitle="role"
          monogram={role.title.slice(0, 1).toUpperCase()}
          title={role.title}
          // Роль без носителей ГАСНЕТ — язык вендоров, где отключённое
          // тускнеет. Бейдж «никому не назначена» был бы вторым способом
          // сказать то же самое.
          dimmed={total === 0}
          meta={
            <>
              {role.audience === "client" ? "клиентам" : "сотрудникам"}
              {" · "}
              {total === 0
                ? "никому не назначена"
                : `${total} ${peopleWord(total)}`}
              {" · "}
              {groups.length ? groups.join(", ") : "прав нет"}
            </>
          }
          openUpdateOnClick
        />
      );
    })}
  </>
);

export default RoleList;
