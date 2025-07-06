import { format, parseISO } from "date-fns";
import { toZonedTime, fromZonedTime } from "date-fns-tz";

import { getLocalStorageData } from "./auth";
const { timezone } = getLocalStorageData();

export const formatDate = (date) => {
  return new Date(date).toLocaleDateString("ru", {
    timeZone: timezone || "Asia/Vladivostok",
    weekday: "short",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export const formatShortDate = (date) => {
  return new Date(date).toLocaleDateString("ru", {
    timeZone: timezone || "Asia/Vladivostok",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
};

export const formatDateTime = (unformattedDate) => {
  const { timezone } = getLocalStorageData();
  const date = new Date(unformattedDate);
  return new Date(date).toLocaleDateString("ru", {
    timeZone: timezone || "Asia/Vladivostok",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export const changeTimezone = (unformattedDate) => {
  const date = new Date(unformattedDate);
  const invdate = new Date(
    date.toLocaleString("en-US", {
      timeZone: timezone,
    })
  );

  const diff = date.getTime() - invdate.getTime();

  return new Date(date.getTime() + diff).toISOString().slice(0, 16);
};

export const timeDateInputFormat = (unformattedDate) => {
  const date = new Date(unformattedDate);
  return format(date, "yyyy-MM-dd'T'HH:mm");
};

export const utcToLocalForm = (utcDateString) => {
  const date = toZonedTime(parseISO(utcDateString), timezone);
  return format(date, "yyyy-MM-dd'T'HH:mm");
};

export const utcToLocal = (localDateString) => {
  const date = toZonedTime(new Date(localDateString), timezone);
  return date.toISOString();
};

export const localToUtc = (localDateString) => {
  const date = fromZonedTime(new Date(localDateString), timezone);
  return date.toISOString();
};
