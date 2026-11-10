const mongoose = require("mongoose");
const { fail } = require("./policy");
const DEFAULTS = Object.freeze({
  cpuThreshold: 90,
  memoryThreshold: 90,
  storageWarning: 85,
  storageCritical: 95,
  thresholdMinutes: 5,
  autoTickets: false,
  exposureTicketsEnabled: false,
  cveMinSeverity: "high",
  applicantId: null,
  categoryId: null,
});
const validateSettings = async (input, current = {}, lookups = {}) => {
  if (!input || typeof input !== "object" || Array.isArray(input))
    fail("Настройки Proxmox должны быть объектом");
  const stored = current?.toObject?.() ?? current ?? {};
  const data = Object.fromEntries(
    Object.entries(DEFAULTS).map(([key, value]) => [key, stored[key] ?? value]),
  );
  const changes = {};
  for (const key of Object.keys(DEFAULTS)) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
    const value = input[key];
    if (["applicantId", "categoryId"].includes(key)) {
      if (
        value !== null &&
        value !== "" &&
        (typeof value !== "string" || !mongoose.isValidObjectId(value))
      )
        fail("Некорректный идентификатор аккаунта или категории");
      changes[key] = value || null;
    } else if (key === "cveMinSeverity") {
      if (!["high", "critical"].includes(value))
        fail("Выберите минимальную опасность: High или Critical");
      changes[key] = value;
    } else if (["autoTickets", "exposureTicketsEnabled"].includes(key)) {
      if (typeof value !== "boolean")
        fail("Укажите состояние автоматических заявок");
      changes[key] = value;
    } else {
      const number = Number(value),
        maximum = key === "thresholdMinutes" ? 1440 : 100;
      if (
        value === null ||
        value === "" ||
        !["number", "string"].includes(typeof value) ||
        !Number.isFinite(number) ||
        number < 1 ||
        number > maximum ||
        (key === "thresholdMinutes" && !Number.isInteger(number))
      )
        fail(
          key === "thresholdMinutes"
            ? "Задержка заявки должна быть от 1 до 1440 минут"
            : "Пороги должны быть от 1 до 100%",
        );
      changes[key] = number;
    }
  }
  Object.assign(data, changes);
  if (Object.hasOwn(input, 'networkLinks')) {
    const { validateNetworkLinks, linksVersion } = require('./exposure/network-links');
    const links = await validateNetworkLinks(input.networkLinks, stored.networkLinks, lookups);
    if (JSON.stringify(links) !== JSON.stringify(JSON.parse(JSON.stringify(stored.networkLinks || [])))) {
      changes.networkLinks = links;
      changes.networkLinksVersion = linksVersion(links);
    }
    data.networkLinks = links;
  }
  if (data.storageCritical <= data.storageWarning)
    fail("Критический порог должен быть выше уровня предупреждения");
  if (data.autoTickets && (!data.applicantId || !data.categoryId))
    fail("Выберите сервисный аккаунт и категорию");
  if (
    data.applicantId &&
    (data.autoTickets ||
      (Object.hasOwn(changes, "applicantId") &&
        String(changes.applicantId) !== String(stored.applicantId)))
  ) {
    const exists =
      lookups.accountExists ||
      ((id) =>
        require("../../models/user").exists({
          _id: id,
          isServiceAccount: true,
        }));
    if (!(await exists(data.applicantId)))
      fail("Выберите существующий сервисный аккаунт");
  }
  if (
    data.categoryId &&
    (data.autoTickets ||
      (Object.hasOwn(changes, "categoryId") &&
        String(changes.categoryId) !== String(stored.categoryId)))
  ) {
    const exists =
      lookups.categoryExists ||
      ((id) =>
        require("../../models/ticketCategory").exists({
          _id: id,
          isActive: true,
        }));
    if (!(await exists(data.categoryId)))
      fail("Выберите действующую категорию заявки");
  }
  return { data, changes };
};
module.exports = { validateSettings, DEFAULTS };
