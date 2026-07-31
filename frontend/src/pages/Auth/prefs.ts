// Настройки, которые видит человек ДО входа: бренд, контакты поддержки и два
// флага доступности путей. Отдаёт `GET /api/preferences-auth` (без isAuth).

export type AuthPrefs = {
  /** В базе ноль пользователей — приложение ещё не настроено. */
  firstLaunch: boolean;
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
  /** Нет ни одной активной компании с доменами — регистрации не бывает. */
  selfSignupIsActive: boolean;
};

/**
 * Вход обязан открыться и при недоступных настройках: иначе икота на ручке
 * настроек запирает снаружи всех разом. Поэтому у оболочки есть чем рисовать
 * себя без ответа сервера — просто беднее.
 */
export const FALLBACK_PREFS: AuthPrefs = {
  firstLaunch: false,
  contacts: { title: "", tel: "", email: "", address: "", logo: "" },
  timezone: "",
  emailIsActive: false,
  selfSignupIsActive: false,
};
