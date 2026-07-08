// Reconciliation between an inventory ClientDevice card and the data polled from
// its live Mikrotik device. Pure functions over STORED fields — no live session.
// Used by the parameters-save response, by getOne (standing warning on the device
// page) and by the sync-inventory endpoint (server-side value derivation — client
// input is never trusted).

const norm = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
// Грубая проверка v6-литерала: только hex-группы и двоеточия.
const IPV6_RE = /^[0-9a-f:]+$/i;

const isIpLiteral = (value) => {
  const v = String(value ?? "").trim();
  if (!v) return false;
  return IPV4_RE.test(v) || (v.includes(":") && IPV6_RE.test(v));
};

// Активные адреса устройства без CIDR-префикса ("192.168.1.1/24" → "192.168.1.1").
const activeAddresses = (record) =>
  (record?.addresses || [])
    .filter((item) => item.disabled === "false" && item.address)
    .map((item) => String(item.address).split("/")[0]);

// Предлагаемый для карточки IP: хост подключения, если это IP-литерал (адрес,
// по которому устройство реально доступно), иначе первый активный адрес.
const suggestedIp = (record) => {
  const host = record?.credentials?.host;
  if (isIpLiteral(host)) return String(host).trim();
  return activeAddresses(record)[0] || null;
};

// Значения, которые sync-inventory пишет в карточку. Единственный источник —
// сохранённая запись Mikrotik; поля без данных опускаются.
const deriveSyncValues = (record) => {
  const values = {};
  if (record?.name) values.hostname = record.name;
  if (record?.serialNumber) values.serialNumber = record.serialNumber;
  if (record?.currentFirmware)
    values.operatingSystem = `RouterOS ${record.currentFirmware}`;
  const ip = suggestedIp(record);
  if (ip) values.ipAddress = ip;
  return values;
};

// Сравнение карточки с устройством. Возвращает { checkedAt, mismatches } или
// null, когда записи нет. Пустое значение в карточке при заполненном на
// устройстве — тоже расхождение (синхронизация заполнит поле).
const computeReconciliation = (device, record) => {
  if (!device || !record) return null;

  const mismatches = [];

  // Имя устройства (hostname) ↔ RouterOS identity.
  if (record.name && norm(device.hostname) !== norm(record.name)) {
    mismatches.push({
      field: "hostname",
      label: "Имя устройства (hostname)",
      cardValue: device.hostname || null,
      deviceValue: record.name,
      syncable: true,
    });
  }

  // Серийный номер ↔ /system/routerboard. У CHR серийника нет — правило
  // пропускается целиком, ложных расхождений не бывает.
  if (
    record.serialNumber &&
    String(device.serialNumber ?? "").trim() !==
      String(record.serialNumber).trim()
  ) {
    mismatches.push({
      field: "serialNumber",
      label: "Серийный номер",
      cardValue: device.serialNumber || null,
      deviceValue: record.serialNumber,
      syncable: true,
    });
  }

  // ОС ↔ версия RouterOS.
  if (record.currentFirmware) {
    const expected = `RouterOS ${record.currentFirmware}`;
    if (norm(device.operatingSystem) !== norm(expected)) {
      mismatches.push({
        field: "operatingSystem",
        label: "Операционная система",
        cardValue: device.operatingSystem || null,
        deviceValue: expected,
        syncable: true,
      });
    }
  }

  // IP карточки должен быть одним из адресов устройства (или хостом
  // подключения — NAT-хост тоже валиден, ложных срабатываний на LAN-IP нет).
  const candidates = activeAddresses(record);
  const host = record.credentials?.host;
  if (isIpLiteral(host)) candidates.unshift(String(host).trim());
  if (candidates.length > 0) {
    const cardIp = String(device.ipAddress ?? "").trim();
    const matches = cardIp && candidates.some((c) => c === cardIp);
    if (!matches) {
      mismatches.push({
        field: "ipAddress",
        label: "IP-адрес",
        cardValue: device.ipAddress || null,
        deviceValue: suggestedIp(record),
        deviceValues: [...new Set(candidates)],
        syncable: true,
      });
    }
  }

  // Модель ↔ плата: только сверка (карточку не правим — модель задаёт связку
  // вендор/тип). Анти-шум: расхождение, лишь когда ни одно название не
  // содержит другое ("RB4011iGS+" ⊂ "RouterBOARD RB4011iGS+5HacQ2HnD" — ок).
  const modelName = device.deviceModelId?.name;
  if (record.boardName && modelName) {
    const a = norm(modelName);
    const b = norm(record.boardName);
    if (a && b && !a.includes(b) && !b.includes(a)) {
      mismatches.push({
        field: "model",
        label: "Модель / плата",
        cardValue: modelName,
        deviceValue: record.boardName,
        syncable: false,
      });
    }
  }

  return { checkedAt: new Date(), mismatches };
};

module.exports = { computeReconciliation, deriveSyncValues };
