const User = require("../models/user");
const Connection = require("../models/pro32Connect/connection");

const getAuthData = require("../middleware/getAuthData");
const { AppError } = require("../middleware/errorHandling");

exports.createSupport = async (req, res, next) => {
  try {
    const authedUser = await getAuthData(req);

    if (!authedUser.getScreen.api) {
      return next(
        new AppError(`В настройках пользователя не указан GetScreen API.`, 400),
      );
    }

    const user = await User.findById(req.body.user);

    if (!user) {
      return next(new AppError(`User not found`, 404));
    }

    const response = await fetch(
      `https://api.pro32connect.ru/v1/support/create?apikey=${authedUser.getScreen.api}&client_name=${user.lastName} ${user.firstName}`,
      {
        method: "POST",
      },
    );

    const data = (await response.json()).data;

    const connection = new Connection({
      user: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
      },
      ticket: req.body.ticketNum,
      getScreenId: data.id,
      status: data.status,
      createTime: data.create_time,
      inviteCode: data.invite_code,
      inviteUrl: data.invite_url,
      connectUrl: data.connect_url,
      clientName: data.client_name,
      clientOs: data.client_os,
      clientPreviewUrl: data.client_preview_url,
    });

    await connection.save();

    res.status(200).json(connection);
  } catch (error) {
    next(
      new AppError(
        `Failed to create fast support connection`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.getConnection = async (req, res, next) => {
  try {
    const authedUser = await getAuthData(req);

    const connection = await Connection.findOne({
      ticket: req.params.ticketNum,
    });

    if (!connection) {
      return res
        .status(200)
        .json({ message: "Активных подключений не найдено" });
    }

    if (authedUser.isAdmin) {
      try {
        const response = await fetch(
          `https://api.pro32connect.ru/v1/support/info?apikey=${
            authedUser.getScreen?.api || process.env.GETSCREEN_ROOT_API
          }&connection_id=${connection.getScreenId}`,
        );
        const data = await response.json();

        if (data?.data?.status === 3) {
          await Connection.deleteOne({ _id: connection._id });
          return res
            .status(100)
            .json({ message: "Активных подключений не найдено" });
        }
      } catch (error) {
        if (error.message.includes("404")) {
          await Connection.deleteOne({ _id: connection._id });
        }
        return;
      }
    }

    res.status(200).json(connection);
  } catch (error) {
    next(
      new AppError(`Failed to fetch fast support connection`, 500, true, error),
    );
  }
};
