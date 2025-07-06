const jwt = require("jsonwebtoken");

const { AppError } = require("./errorHandling");

module.exports = (req, res, next) => {
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
    req.isAuth = false;
    return next(new AppError(`Некорректный токен.`, 401));
  }
  req.userId = decodedToken.userId;
  next();
};
