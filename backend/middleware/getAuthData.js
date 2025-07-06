const jwt = require("jsonwebtoken");

const logger = require("../utils/logger");

const User = require("../models/user");

module.exports = async (req) => {
  const authHeader = req.get("Authorization");
  if (!authHeader) {
    return logger.log(
      "error",
      "Для обработки запроса требуется заголовок с токеном",
    );
  }
  const token = authHeader.split(" ")[1];
  const decodedToken = jwt.decode(token, process.env.JWT_SECRET);
  const user = await User.findById(decodedToken.userId);
  const authedUser = { ...user.toObject(), userId: user._id.toString() };
  return authedUser;
};
