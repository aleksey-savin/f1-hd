const mongoose = require("mongoose");
const CompanyLog = require("@/models/companyLog");

// «Компьютер человека» по журналу входов. Последний вход сам по себе его не
// называет: человек входит на свою рабочую станцию, а следом — на терминальный
// сервер, и сервер перебивал бы станцию у всей компании. Общий компьютер
// узнаётся по журналу: за окно на него входило несколько разных учёток.
// Такие компьютеры пропускаются; если других входов у учётки нет, остаётся
// общий — это лучше пустого места.
const SHARED_WINDOW_DAYS = 30;
const SHARED_MIN_ACCOUNTS = 3;

const toObjectId = (id) => new mongoose.Types.ObjectId(String(id));

const sharedComputerNames = async (companyId, now = new Date()) => {
  if (!companyId) return [];
  const since = new Date(now.getTime() - SHARED_WINDOW_DAYS * 86400000);
  const rows = await CompanyLog.aggregate([
    {
      $match: {
        companyId: toObjectId(companyId),
        createdAt: { $gte: since },
        computerName: { $nin: [null, ""] },
      },
    },
    {
      $group: {
        _id: "$computerName",
        accounts: { $addToSet: "$activeDirectoryObjectGUID" },
      },
    },
    { $match: { [`accounts.${SHARED_MIN_ACCOUNTS - 1}`]: { $exists: true } } },
  ]);
  return rows.map((row) => row._id);
};

// Последний вход каждой учётки компании на необщий компьютер:
// Map GUID → { computerName, lastSeenAt }. Учёток без такого входа в ней нет.
const personalComputersByAccount = async (companyId) => {
  const shared = await sharedComputerNames(companyId);
  if (shared.length === 0) return new Map();
  const rows = await CompanyLog.aggregate([
    {
      $match: {
        companyId: toObjectId(companyId),
        computerName: { $nin: [null, "", ...shared] },
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: "$activeDirectoryObjectGUID",
        computerName: { $first: "$computerName" },
        lastSeenAt: { $first: "$createdAt" },
      },
    },
  ]);
  return new Map(
    rows.map((row) => [
      row._id,
      { computerName: row.computerName, lastSeenAt: row.lastSeenAt },
    ]),
  );
};

// Последний вход одной учётки: на необщий компьютер, а без такого — любой
// с именем компьютера.
const lastComputerLogin = async ({ companyId, activeDirectoryObjectGUID }) => {
  const find = (excluded) =>
    CompanyLog.findOne({
      activeDirectoryObjectGUID,
      computerName: { $nin: [null, "", ...excluded] },
    })
      .sort({ createdAt: -1 })
      .select("computerName activeDirectoryLogin createdAt")
      .lean();

  const shared = await sharedComputerNames(companyId);
  if (shared.length === 0) return find([]);
  return (await find(shared)) || find([]);
};

module.exports = {
  SHARED_WINDOW_DAYS,
  SHARED_MIN_ACCOUNTS,
  sharedComputerNames,
  personalComputersByAccount,
  lastComputerLogin,
};
