// Доменные типы пользователя на фронте. Зеркалит идею `backend/types/` —
// общие доменные модели живут здесь, а не инлайн в компонентах (пропсы —
// наоборот, co-located рядом с компонентом).

// Авторизованный пользователь — то, что провайдер `AuthedUserContext` кладёт в
// контекст (layout/Root: `{ ...defaultAuthedUser, ...userData }`). Читается
// типобезопасным хуком `useAuthedUser()` из `store/authed-user`. Поля
// добавляем по мере того, как их начинает читать TS-код.
export type AuthedUser = {
  _id: string;
  firstName?: string;
  lastName?: string;
  position?: string;
  isAdmin?: boolean;
  isEndUser?: boolean;
  permissions: Record<string, boolean>;
  workStatus?: { code: string; note: string; updatedAt: string | null };
};
