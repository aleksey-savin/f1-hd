import { createContext, useContext, useMemo } from "react";

import {
  displayTimeZone,
  formatDateTime,
  formatShortDate,
  formatWeekdayDateTime,
} from "../../util/format-date";
import { utcOffsetLabel, zoneOffsetMinutes } from "../../util/timezone-catalog";
import { orgTimezone, tzCity } from "../../util/timezone-display";

/**
 * Пояс, в котором показывается отчёт по услуге.
 *
 * Остальное приложение показывает время в личном поясе человека
 * (util/format-date). Отчёт — исключение: он посчитан в поясе организации, и
 * работа, попавшая в «нерабочее время», обязана выглядеть нерабочей у любого
 * зрителя. В личном поясе 19:30 превращались в 16:30 — и таблица спорила с
 * собственным заголовком.
 *
 * Пояс приходит с сервера вместе с отчётом (`zone` в ответе): это тот самый
 * пояс, в котором считались деньги. На странице по ссылке из письма сессии
 * нет, и взять его больше неоткуда.
 */
const ReportZoneContext = createContext<string | null>(null);

export const ReportZoneProvider = ReportZoneContext.Provider;

export type ReportDates = {
  zone: string;
  /** «Владивосток (UTC+10)» — подпись пояса в условиях расчёта и выгрузке. */
  zoneLabel: string;
  /** «Владивосток» — короткая подпись у колонки времени. */
  zoneCity: string;
  /** Личный пояс зрителя показывает другое настенное время. */
  differs: boolean;
  shortDate: (value?: string | Date | null) => string | null;
  dateTime: (value?: string | Date | null) => string | null;
  weekdayDateTime: (value?: string | Date | null) => string | null;
};

export const reportDates = (zone: string): ReportDates => {
  const offset = zoneOffsetMinutes(zone);
  const city = tzCity(zone);
  return {
    zone,
    zoneCity: city,
    zoneLabel: offset === null ? city : `${city} (${utcOffsetLabel(offset)})`,
    // Сравниваем смещения, а не названия зон: Europe/Volgograd и Europe/Moscow —
    // разные строки и одно настенное время
    differs: zoneOffsetMinutes(displayTimeZone()) !== offset,
    shortDate: (value) => formatShortDate(value, { timeZone: zone }),
    dateTime: (value) => formatDateTime(value, { timeZone: zone }),
    weekdayDateTime: (value) =>
      formatWeekdayDateTime(value, { timeZone: zone }),
  };
};

/** Даты отчёта в поясе организации — для всего, что рисует карточку и список. */
export const useReportDates = (): ReportDates => {
  const zone = useContext(ReportZoneContext) || orgTimezone();
  return useMemo(() => reportDates(zone), [zone]);
};
