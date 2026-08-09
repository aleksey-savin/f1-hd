/**
 * Явный список источников вместо `Access-Control-Allow-Origin: *`.
 *
 * Причина не только в куках, хотя спецификация и запрещает `*` вместе с
 * `Allow-Credentials`. Звёздочка разрешала ЛЮБОМУ сайту читать ответы нашего
 * API от имени залогиненного человека; до сих пор спасало лишь то, что токен
 * лежал в localStorage и браузер сам его не подставлял. С httpOnly-куками это
 * стало бы прямым захватом сеанса, поэтому меняется в том же релизе.
 *
 * В проде фронтенд и API за одним nginx, поэтому список пуст и заголовки не
 * выставляются вовсе. Он нужен деву и будущему отдельному домену фронтенда.
 */
const ORIGINS = String(process.env.CORS_ORIGINS || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

module.exports = (req, res, next) => {
  const origin = req.get("Origin");

  if (origin && ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    // Без Vary кэш — браузерный или будущий CDN — отдаст заголовок одного
    // источника другому.
    res.setHeader("Vary", "Origin");
  }

  res.setHeader(
    "Access-Control-Allow-Methods",
    "OPTIONS, GET, POST, PUT, PATCH, DELETE",
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Accept, Content-Type, Authorization, X-Requested-With, X-API-Key, X-TG-Token",
  );
  res.setHeader("Access-Control-Max-Age", "600");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
};
