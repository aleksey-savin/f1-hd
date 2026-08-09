/**
 * Проверка прав на клиенте — тем же словарём, что и на сервере.
 *
 * Что решает интерфейс: показать пункт меню, кнопку, вкладку. Настоящее
 * решение всё равно за сервером — здесь только то, чего человеку не предлагать,
 * чтобы он не жал в 403.
 *
 * Форма запроса совпадает с серверной: `can({ ticket: ["delete"] })`. Внутри
 * одного ресурса действия складываются по И; `{ actions, connector: "OR" }` —
 * по ИЛИ. Ключи ресурсов и действий приходят с сервера в `statements`, своего
 * списка здесь нет и быть не должно: два словаря разошлись бы на первой правке.
 */

export type Statements = Record<string, string[]>;

export type AccessRequest = Record<
  string,
  string[] | { actions: string[]; connector?: "AND" | "OR" }
>;

const isAllowed = (
  granted: string[] | undefined,
  requested: AccessRequest[string],
): boolean => {
  if (!granted?.length) return false;

  const { actions, connector } = Array.isArray(requested)
    ? { actions: requested, connector: "AND" as const }
    : { actions: requested.actions || [], connector: requested.connector };

  if (!actions.length) return false;
  return connector === "OR"
    ? actions.some((action) => granted.includes(action))
    : actions.every((action) => granted.includes(action));
};

/**
 * Собирает `can` по набору statements. Администратор проходит везде — как и на
 * сервере: это признак учётной записи, а не право.
 */
export function makeCan(statements: Statements | undefined, isAdmin: boolean) {
  return (request: AccessRequest): boolean => {
    if (isAdmin) return true;
    const resources = Object.entries(request);
    if (!resources.length) return false;
    return resources.every(([resource, requested]) =>
      isAllowed(statements?.[resource], requested),
    );
  };
}

export type Can = ReturnType<typeof makeCan>;

/** Пока права не загрузились — не показываем ничего лишнего. */
export const denyAll: Can = () => false;
