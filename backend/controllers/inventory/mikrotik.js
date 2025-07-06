const { Routeros } = require("routeros-node");
const jwt = require("jsonwebtoken");

const Mikrotik = require("../../models/mikrotik");

const { AppError } = require("../../middleware/errorHandling");

exports.getAll = async (req, res, next) => {
  try {
    const devices = await Mikrotik.find({}).sort({ name: 1 });

    res.status(200).json(devices);
  } catch (error) {
    next(new AppError("Failed to fetch mikrotik devices", 500, true, error));
  }
};

exports.getOne = async (req, res, next) => {
  try {
    const device = await Mikrotik.findById(req.params.id);
    if (!device) {
      return next(
        new AppError(`Mikrotik device with id ${req.params.id} not found`, 404),
      );
    }

    res.status(200).json({
      device: device,
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to fetch mikrotik device with id ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.add = async (req, res, next) => {
  const { host, port, user, password, description } = req.body;

  const routeros = new Routeros({
    host: host,
    port: port,
    user: user,
    password: password,
  });

  try {
    const { host, port, user, password } = req.body;

    const routeros = new Routeros({
      host: host,
      port: port,
      user: user,
      password: password,
    });

    // connect to RouterOS
    const conn = await routeros.connect();

    const addresses = await conn.write(["/ip/address/print"]);
    const identity = await conn.write(["/system/identity/print"]);
    const resource = await conn.write(["/system/resource/print"]);
    const users = await conn.write(["/user/print"]);

    const mikrotikUser = users.find((item) => item.name === user);

    if (mikrotikUser.group === "full") {
      return next(
        new AppError(
          `Вы не можете добавить пользователя из группы Full для устройства ${req.body.host}`,
          409,
        ),
      );
    }

    const deviceExists = await Mikrotik.findOne({
      name: identity[0].name,
    });

    if (deviceExists) {
      return next(
        new AppError(
          `Устройство Mikrotik с именем ${identity[0].name} уже есть в списке.`,
          409,
        ),
      );
    }

    const device = new Mikrotik({
      credentials: {
        host: host,
        port: port,
        user: user,
        password: jwt.sign(password, process.env.JWT_SECRET),
      },
      name: identity[0].name,
      boardName: resource[0]["board-name"],
      currentFirmware: resource[0]["version"],
      addresses: addresses,
      description: description,
    });

    await device.save();

    res.status(201).json({
      message: "Device added successfully!",
      device: device,
    });
  } catch (error) {
    next(new AppError("Failed to add mikrotik device", 500, true, error));
  } finally {
    // dont forget to close connection
    routeros.destroy();
  }
};

exports.updateInfo = async (req, res, next) => {
  const device = await Mikrotik.findById(req.body._id);
  const routeros = new Routeros({
    host: device.credentials.host,
    port: device.credentials.port,
    user: device.credentials.user,
    password: jwt.decode(device.credentials.password, process.env.JWT_SECRET),
  });
  try {
    // connect to RouterOS
    const conn = await routeros.connect();

    const addresses = await conn.write(["/ip/address/print"]);
    const identity = await conn.write(["/system/identity/print"]);
    const resource = await conn.write(["/system/resource/print"]);

    device.description = req.body.description;
    device.name = identity[0].name;
    device.boardName = resource[0]["board-name"];
    device.currentFirmware = resource[0]["version"];
    device.addresses = addresses;

    await device.save();

    res.status(200).json({
      message: "Device info updated successfully!",
      device: {
        name: device.name,
        addresses: device.addresses,
        osVersion: device.osVersion,
        description: device.description,
      },
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to update mikrotik device with id ${req.body._id}`,
        500,
        true,
        error,
      ),
    );
  } finally {
    // dont forget to close connection
    routeros.destroy();
  }
};

exports.updateCredentials = async (req, res, next) => {
  const device = await Mikrotik.findById(req.body_id);

  const { host, port, user, password } = req.body.credentials;

  const routeros = new Routeros({
    host: host,
    port: port,
    user: user,
    password: password,
  });

  try {
    // connect to RouterOS
    await routeros.connect();

    device.credentials = {
      host: host,
      port: port,
      user: user,
      password: jwt.sign(password, process.env.JWT_SECRET),
    };

    await device.save();

    res.status(200).json({
      message: "Device credentials updated successfully!",
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to updated credentials for mikrotik device with id ${req.body._id}`,
        500,
        true,
        error,
      ),
    );
  } finally {
    // dont forget to close connection
    routeros.destroy();
  }
};

exports.delete = async (req, res, next) => {
  try {
    const device = await Mikrotik.findById(req.body._id);

    if (device) {
      await Mikrotik.deleteOne({ _id: req.body._id });
      res.status(204).end();
    } else {
      return next(
        new AppError(
          `Couldn't find Mikrotik device with id ${req.body._id}`,
          404,
        ),
      );
    }
  } catch (error) {
    next(
      new AppError(
        `Failed to delete mikrotik device with id ${req.body._id}`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.networksReport = async (req, res, next) => {
  try {
    const devices = await Mikrotik.find({}).sort({ name: 1 });

    let entries = [];

    for (let device of devices) {
      for (let address of device.addresses) {
        if (address.disabled === "false") {
          entries.push({
            id: address._id,
            address: address.address,
            network: address.network,
            interface: address.interface,
            deviceName: device.name,
            comment: address.comment,
            duplicated: false,
          });
        }
      }
    }

    entries.forEach((entry) => {
      const isDuplicated =
        entries.filter(({ network }) => network === entry.network).length > 1;
      if (isDuplicated) {
        entry.duplicated = true;
      }
    });

    res.status(200).json({
      entries: entries,
    });
  } catch (error) {
    next(new AppError(`Failed to generate networks report`, 500, true, error));
  }
};
