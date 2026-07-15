import { useContext } from "react";

import { AuthedUserContext } from "@/store/authed-user-context";
import type { AuthedUser } from "@/types/user";

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
