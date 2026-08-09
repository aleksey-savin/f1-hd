// Настройки, которые видит человек ДО входа: бренд и контакты поддержки.
// Отдаёт `GET /api/preferences-auth` (без авторизации).

export type AuthPrefs = {
  contacts: {
    /** Подпись под маркой; задаётся в «Настройках → Основные». */
    title: string;
    tel: string;
    email: string;
    address: string;
    logo: string;
  };
  timezone: string;
  /** Почта выключена — ссылку на смену пароля отправить нечем. */
  emailIsActive: boolean;
};

/**
 * Вход обязан открыться и при недоступных настройках: иначе икота на ручке
 * настроек запирает снаружи всех разом. Поэтому у оболочки есть чем рисовать
 * себя без ответа сервера — просто беднее.
 */
export const FALLBACK_PREFS: AuthPrefs = {
  contacts: { title: "", tel: "", email: "", address: "", logo: "" },
  timezone: "",
  emailIsActive: false,
};
