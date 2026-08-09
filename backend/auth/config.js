// Конфигурация better-auth, собранная на стороне CommonJS: сам инстанс живёт в
// ESM-острове (auth/instance.mjs), куда module-alias и наши require не достают,
// поэтому всё прикладное передаётся туда параметрами отсюда.

const asList = (value) =>
  String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const publicUrl = process.env.APP_PUBLIC_URL || process.env.ADDRESS || "";

module.exports = {
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: publicUrl,
  basePath: "/api/auth",

  // В проде фронт и API за одним nginx, поэтому список пуст и заголовки CORS не
  // выставляются вовсе. Нужен деву и будущему отдельному домену фронта.
  trustedOrigins: asList(process.env.CORS_ORIGINS),

  isProduction: process.env.NODE_ENV === "production",

  // Имя, которое человек увидит в приложении-аутентификаторе рядом с кодом.
  // Домен, а не «Helpdesk»: у кого несколько порталов, различать надо их.
  totpIssuer:
    String(publicUrl || "")
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "") || "Helpdesk",

  // Совпадает с нынешним сроком JWT, чтобы переезд не поменял привычный горизонт
  sessionExpiresInSeconds: 60 * 60 * 24 * 14,
  // Скользящее окно: сессия продлевается не чаще раза в сутки
  sessionUpdateAgeSeconds: 60 * 60 * 24,
  // «Свежесть» для чувствительных операций — понадобится при отключении 2FA
  sessionFreshAgeSeconds: 60 * 60,
};
