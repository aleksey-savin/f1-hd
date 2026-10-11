// Настройки, которые видит человек ДО входа: бренд и контакты поддержки.
// Отдаёт `GET /api/preferences-auth` (без авторизации).

import { DEFAULT_BRAND } from "../../util/brand.js";

export type AuthPrefs = {
  contacts: {
    /** Подпись под маркой; задаётся в «Настройках → Основные». */
    title: string;
    tel: string;
    email: string;
    address: string;
    logo: string;
  };
  /**
   * Бренд инсталляции: название портала, акцент, значок («Настройки → Бренд»).
   * Подписи писем здесь нет: до входа сервер её не отдаёт.
   */
  brand: {
    productName: string;
    /** Цвет акцента, `#rrggbb` в нижнем регистре. */
    accent: string;
    /** Имя файла своего значка; пусто — значок по умолчанию. */
    icon: string;
  };
  timezone: string;
  /** Почта выключена — код для входа отправить нечем. */
  emailIsActive: boolean;
};

/**
 * Вход обязан открыться и при недоступных настройках: иначе икота на ручке
 * настроек запирает снаружи всех разом. Поэтому у оболочки есть чем рисовать
 * себя без ответа сервера — просто беднее.
 */
export const FALLBACK_PREFS: AuthPrefs = {
  contacts: { title: "", tel: "", email: "", address: "", logo: "" },
  brand: { ...DEFAULT_BRAND },
  timezone: "",
  emailIsActive: false,
};
