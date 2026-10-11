const path = require("path");

const Preferences = require("../models/preferences");
const storage = require("../services/storage");
const { resolveBrand } = require("../services/brand");
const logger = require("../utils/logger");

/**
 * Значок и веб-манифест инсталляции — ОТКРЫТЫЕ ручки: их запрашивает сам
 * браузер (favicon, ярлык на телефоне, `<link rel="manifest">`) до входа и без
 * cookie. Отдают только то, что и так видно на экране входа: название портала,
 * цвет акцента и значок.
 *
 * Обе кэшируются на пять минут и не падают: без настроек, при сбое базы или
 * пропавшем файле уходит значок и название продукта по умолчанию — вкладка без
 * значка хуже, чем вкладка с нейтральным.
 */
const CACHE_CONTROL = "public, max-age=300";

// Нейтральный значок продукта: 192×192, лежит в образе рядом с кодом
const DEFAULT_ICON_PATH = path.join(__dirname, "..", "assets", "brand-icon.png");

const ICON_HEADERS = { "Cache-Control": CACHE_CONTROL, "Content-Type": "image/png" };

const loadBrand = async () => {
  try {
    return resolveBrand(await Preferences.findOne({}).lean());
  } catch (error) {
    logger.warn(`Brand settings unavailable, serving defaults: ${error.message}`);
    return resolveBrand(null);
  }
};

const sendDefaultIcon = (res, next) =>
  res.sendFile(DEFAULT_ICON_PATH, { headers: ICON_HEADERS }, (error) => {
    if (error && !res.headersSent) next(error);
  });

exports.icon = async (req, res, next) => {
  const brand = await loadBrand();

  // Значок лежит локально в uploads/, как лого (middleware/imageUpload.js);
  // имя приводится к basename — путь из базы не должен вывести из каталога
  const name = brand.icon ? path.basename(brand.icon) : "";
  if (!name || !storage.objectExistsLocally(name)) return sendDefaultIcon(res, next);

  res.sendFile(path.resolve("uploads", name), { headers: ICON_HEADERS }, (error) => {
    // Файл пропал между проверкой и отдачей — нейтральный значок
    if (error && !res.headersSent) sendDefaultIcon(res, next);
  });
};

exports.manifest = async (req, res) => {
  const brand = await loadBrand();

  const body = JSON.stringify({
    name: brand.productName,
    short_name: brand.productName.slice(0, 12),
    start_url: "/",
    display: "standalone",
    theme_color: brand.accent,
    background_color: "#ffffff",
    icons: [{ src: "/api/brand/icon", sizes: "192x192", type: "image/png" }],
  })
    // Название пишет человек: «<» уходит < — тот же JSON, но ответ нельзя
    // прочитать как разметку, даже если его тип где-то потеряется
    .replace(/</g, "\\u003c");

  res.status(200);
  res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
  res.setHeader("Cache-Control", CACHE_CONTROL);
  res.send(body);
};

exports.DEFAULT_ICON_PATH = DEFAULT_ICON_PATH;
