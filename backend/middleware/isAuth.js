const jwt = require("jsonwebtoken");

const { AppError } = require("./errorHandling");
const User = require("../models/user");

module.exports = async (req, res, next) => {
  const authHeader = req.get("Authorization");
  if (!authHeader) {
    req.isAuth = false;
    return next(
      new AppError(`Для обработки запроса требуется заголовок с токеном.`, 401),
    );
  }
  const token = authHeader.split(" ")[1];
  let decodedToken;
  try {
    decodedToken = jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    req.isAuth = false;
    return next(new AppError(`Некорректный токен.`, 401, true, error));
  }
  if (!decodedToken) {
    req.isAuth = false;
    return next(new AppError(`Некорректный токен.`, 401));
  }

  // JWT живёт 14 дней, поэтому деактивация пользователя должна гасить и уже
  // выданные токены — статус учётки проверяется на каждом запросе.
  try {
    const user = await User.findById(decodedToken.userId).select("isActive");
    if (!user || !user.isActive) {
      req.isAuth = false;
      return next(new AppError(`Учётная запись отключена.`, 401));
    }
  } catch (error) {
    return next(
      new AppError(`Не удалось проверить учётную запись.`, 500, true, error),
    );
  }

  req.userId = decodedToken.userId;
  next();
};
