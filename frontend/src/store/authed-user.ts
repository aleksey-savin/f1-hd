import { useContext, useMemo } from "react";

import { AuthedUserContext } from "@/store/authed-user-context";
import { makeCan, type Can, type Statements } from "@/lib/access";
import type { AuthedUser } from "@/types/user";

/** Одно действие словаря так, как его отдаёт сервер. */
export type PermissionAction = {
  id: string;
  label: string;
  hint?: string;
};

/** Группа действий — раздел в форме роли и в карточке человека. */
export type PermissionGroup = {
  key: string;
  label: string;
  actions: PermissionAction[];
};

// Типобезопасный доступ к авторизованному пользователю.
//
// Стор `authed-user-context.js` пока на JS и создаётся с ЧАСТИЧНЫМ дефолтом
// (`{ permissions: {}, workStatus }`), поэтому вывод типа контекста не знает ни
// про `_id`, ни про флаги прав — потребители на TS ломались бы на выводе.
// Реальное значение из провайдера (layout/Root) — полный пользователь; сам тип
// `AuthedUser` — доменный, живёт в `@/types/user`, здесь только граница до
// миграции стора на TS.
export function useAuthedUser(): AuthedUser {
  // as unknown as: значение приходит из JS-стора, его вывод типа опирается на
  // частичный дефолт и заведомо уже реального объекта — приводим осознанно.
  return useContext(AuthedUserContext) as unknown as AuthedUser;
}

/**
 * Права текущего человека тем же словарём, что и на сервере:
 * `can({ ticket: ["delete"] })`.
 *
 * Интерфейс решает, что ПОКАЗАТЬ; доступ всё равно даёт сервер. Список ресурсов
 * и действий приходит в `statements` из `/api/me` — своего словаря на клиенте
 * нет, иначе два списка разошлись бы на первой же правке прав.
 */
export function useCan(): Can {
  const user = useContext(AuthedUserContext) as unknown as {
    statements?: Statements;
  };
  return useMemo(() => makeCan(user?.statements), [user?.statements]);
}

/**
 * Словарь прав с подписями — тот же, что объявлен на сервере, привезённый в
 * `/api/me`. Своего списка на клиенте нет: подписи жили копией и разъезжались.
 *
 * Форма роли рисует по нему матрицу, карточка человека — выданные права, а
 * `InlineForbidden` берёт отсюда название права, которого не хватило.
 */
export function usePermissionCatalogue(): PermissionGroup[] {
  const user = useContext(AuthedUserContext) as unknown as {
    permissionCatalogue?: PermissionGroup[];
  };
  return user?.permissionCatalogue || [];
}

/** Подпись одного действия, «ресурс.действие» → «Удалять заявки». */
export function usePermissionLabels(): Record<string, PermissionAction> {
  const groups = usePermissionCatalogue();
  return useMemo(
    () =>
      Object.fromEntries(
        groups.flatMap((group) =>
          group.actions.map((action) => [action.id, action]),
        ),
      ),
    [groups],
  );
}
