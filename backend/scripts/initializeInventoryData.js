const mongoose = require("mongoose");
const DeviceType = require("../models/inventory/deviceType");
const Vendor = require("../models/inventory/vendor");
const DeviceAttribute = require("../models/inventory/deviceAttribute");
const DeviceTypeAttribute = require("../models/inventory/deviceTypeAttribute");

// Каноничное имя вендора MikroTik. Его же использует seedMikrotikModels.js,
// поэтому вынесено в экспортируемую константу — чтобы имя не разъехалось.
const MIKROTIK_VENDOR_NAME = "MikroTik";

// Код обязательного атрибута «Год выпуска». Добавляется ко ВСЕМ типам устройств
// (required: true) — нужен для учёта амортизации и морального устаревания техники.
const MANUFACTURE_YEAR_CODE = "manufactureyear";

// «Год выпуска» показываем В КОНЦЕ списка атрибутов типа. Большой order гарантирует
// последнюю позицию независимо от числа type-specific атрибутов (у них order 1..N).
const YEAR_DISPLAY_ORDER = 999;

// Справочник атрибутов (глобальный). Схема: { code, name, valueType, unit?, options? }.
// code — машинный ключ (lowercase, unique), name — отображаемое имя.
const initialDeviceAttributes = [
  {
    code: MANUFACTURE_YEAR_CODE,
    name: "Год выпуска",
    valueType: "number",
  },
  // Общие
  {
    code: "ram",
    name: "Оперативная память",
    valueType: "select",
    unit: "ГБ",
    options: [
      { value: "4", label: "4 ГБ" },
      { value: "8", label: "8 ГБ" },
      { value: "16", label: "16 ГБ" },
      { value: "32", label: "32 ГБ" },
      { value: "64", label: "64 ГБ" },
      { value: "128", label: "128 ГБ" },
    ],
  },
  {
    code: "storage",
    name: "Накопитель",
    valueType: "select",
    unit: "ГБ",
    options: [
      { value: "128", label: "128 ГБ SSD" },
      { value: "256", label: "256 ГБ SSD" },
      { value: "512", label: "512 ГБ SSD" },
      { value: "1024", label: "1 ТБ SSD" },
      { value: "2048", label: "2 ТБ SSD" },
    ],
  },
  {
    code: "processor",
    name: "Процессор",
    valueType: "string",
  },
  {
    code: "graphics",
    name: "Видеокарта",
    valueType: "string",
  },
  {
    code: "screensize",
    name: "Диагональ экрана",
    valueType: "select",
    unit: "дюймов",
    options: [
      { value: "13.3", label: '13.3"' },
      { value: "14", label: '14"' },
      { value: "15.6", label: '15.6"' },
      { value: "17.3", label: '17.3"' },
      { value: "21.5", label: '21.5"' },
      { value: "23.8", label: '23.8"' },
      { value: "27", label: '27"' },
      { value: "32", label: '32"' },
    ],
  },
  {
    code: "resolution",
    name: "Разрешение экрана",
    valueType: "select",
    options: [
      { value: "1920x1080", label: "Full HD (1920x1080)" },
      { value: "2560x1440", label: "QHD (2560x1440)" },
      { value: "3840x2160", label: "4K (3840x2160)" },
    ],
  },
  {
    code: "ports",
    name: "Порты",
    valueType: "text",
  },
  {
    code: "powersupply",
    name: "Блок питания",
    valueType: "string",
    unit: "Вт",
  },
  // Серверные
  {
    code: "rackunits",
    name: "Высота в юнитах",
    valueType: "select",
    unit: "U",
    options: [
      { value: "1", label: "1U" },
      { value: "2", label: "2U" },
      { value: "4", label: "4U" },
    ],
  },
  {
    code: "cpusockets",
    name: "Количество сокетов ЦП",
    valueType: "select",
    options: [
      { value: "1", label: "1 сокет" },
      { value: "2", label: "2 сокета" },
      { value: "4", label: "4 сокета" },
    ],
  },
  // Принтеры
  {
    code: "printtechnology",
    name: "Технология печати",
    valueType: "select",
    options: [
      { value: "laser", label: "Лазерная" },
      { value: "inkjet", label: "Струйная" },
      { value: "thermal", label: "Термическая" },
    ],
  },
  {
    code: "printspeed",
    name: "Скорость печати",
    valueType: "number",
    unit: "стр/мин",
  },
  {
    code: "colorprinting",
    name: "Цветная печать",
    valueType: "boolean",
  },
  // Сетевое оборудование
  {
    code: "portcount",
    name: "Количество портов",
    valueType: "number",
  },
  {
    code: "portspeed",
    name: "Скорость портов",
    valueType: "select",
    unit: "Гбит/с",
    options: [
      { value: "1", label: "1 Гбит/с" },
      { value: "2.5", label: "2.5 Гбит/с" },
      { value: "10", label: "10 Гбит/с" },
      { value: "25", label: "25 Гбит/с" },
      { value: "40", label: "40 Гбит/с" },
      { value: "100", label: "100 Гбит/с" },
    ],
  },
  {
    code: "poesupport",
    name: "Поддержка PoE",
    valueType: "boolean",
  },
  // ИБП
  {
    code: "upspower",
    name: "Мощность ИБП",
    valueType: "number",
    unit: "ВА",
  },
  {
    code: "batteryruntime",
    name: "Время автономной работы",
    valueType: "number",
    unit: "мин",
  },
  // Мобильные устройства
  {
    code: "operatingsystem",
    name: "Операционная система",
    valueType: "select",
    options: [
      { value: "ios", label: "iOS" },
      { value: "android", label: "Android" },
      { value: "windows", label: "Windows" },
      { value: "macos", label: "macOS" },
      { value: "linux", label: "Linux" },
      { value: "routeros", label: "RouterOS" },
    ],
  },
  {
    code: "batterycapacity",
    name: "Емкость батареи",
    valueType: "number",
    unit: "мАч",
  },
  {
    code: "simcount",
    name: "Количество SIM",
    valueType: "number",
  },
];

// Карта тип → атрибуты (type-specific). Порядок order начинается с 1;
// «Год выпуска» (order 0, required) добавляется ко всем типам автоматически ниже.
const deviceTypeAttributes = {
  Ноутбук: [
    { code: "processor", required: true, order: 1 },
    { code: "ram", required: true, order: 2 },
    { code: "storage", required: true, order: 3 },
    { code: "graphics", required: false, order: 4 },
    { code: "screensize", required: false, order: 5 },
    { code: "resolution", required: false, order: 6 },
    { code: "operatingsystem", required: false, order: 7 },
    { code: "batterycapacity", required: false, order: 8 },
  ],
  "Настольный компьютер": [
    { code: "processor", required: true, order: 1 },
    { code: "ram", required: true, order: 2 },
    { code: "storage", required: true, order: 3 },
    { code: "graphics", required: false, order: 4 },
    { code: "powersupply", required: false, order: 5 },
    { code: "operatingsystem", required: false, order: 6 },
  ],
  Монитор: [
    { code: "screensize", required: true, order: 1 },
    { code: "resolution", required: true, order: 2 },
    { code: "ports", required: false, order: 3 },
  ],
  Принтер: [
    { code: "printtechnology", required: true, order: 1 },
    { code: "colorprinting", required: false, order: 2 },
    { code: "printspeed", required: false, order: 3 },
  ],
  Сканер: [{ code: "resolution", required: false, order: 1 }],
  "Мобильный телефон": [
    { code: "operatingsystem", required: true, order: 1 },
    { code: "ram", required: false, order: 2 },
    { code: "storage", required: false, order: 3 },
    { code: "batterycapacity", required: false, order: 4 },
    { code: "simcount", required: false, order: 5 },
  ],
  Планшет: [
    { code: "operatingsystem", required: true, order: 1 },
    { code: "ram", required: false, order: 2 },
    { code: "storage", required: false, order: 3 },
    { code: "screensize", required: false, order: 4 },
    { code: "batterycapacity", required: false, order: 5 },
  ],
  Сервер: [
    { code: "processor", required: true, order: 1 },
    { code: "cpusockets", required: false, order: 2 },
    { code: "ram", required: true, order: 3 },
    { code: "storage", required: true, order: 4 },
    { code: "rackunits", required: false, order: 5 },
    { code: "powersupply", required: false, order: 6 },
  ],
  "Сетевое оборудование": [
    { code: "portcount", required: false, order: 1 },
    { code: "portspeed", required: false, order: 2 },
    { code: "poesupport", required: false, order: 3 },
    { code: "powersupply", required: false, order: 4 },
  ],
  ИБП: [
    { code: "upspower", required: true, order: 1 },
    { code: "batteryruntime", required: false, order: 2 },
  ],
  Моноблок: [
    { code: "processor", required: true, order: 1 },
    { code: "ram", required: true, order: 2 },
    { code: "storage", required: true, order: 3 },
    { code: "graphics", required: false, order: 4 },
    { code: "screensize", required: false, order: 5 },
    { code: "resolution", required: false, order: 6 },
    { code: "operatingsystem", required: false, order: 7 },
  ],
  "SIP-телефон": [
    { code: "portcount", required: false, order: 1 },
    { code: "poesupport", required: false, order: 2 },
  ],
  // Гранулярные сетевые типы. Имена совпадают строкой с DEVICE_KIND_PATTERNS
  // в models/mikrotik.js — иначе авто-классификация MikroTik не сойдётся.
  Маршрутизатор: [
    { code: "portcount", required: false, order: 1 },
    { code: "portspeed", required: false, order: 2 },
    { code: "poesupport", required: false, order: 3 },
    { code: "powersupply", required: false, order: 4 },
  ],
  Коммутатор: [
    { code: "portcount", required: false, order: 1 },
    { code: "portspeed", required: false, order: 2 },
    { code: "poesupport", required: false, order: 3 },
    { code: "powersupply", required: false, order: 4 },
  ],
  "Точка доступа": [
    { code: "portcount", required: false, order: 1 },
    { code: "portspeed", required: false, order: 2 },
    { code: "poesupport", required: false, order: 3 },
  ],
  "Cloud Hosted Router": [
    { code: "operatingsystem", required: false, order: 1 },
  ],
};

// Типы устройств (глобальные). Поля description в схеме нет — не задаём.
const initialDeviceTypes = [
  { name: "Ноутбук", isActive: true },
  { name: "Настольный компьютер", isActive: true },
  { name: "Монитор", isActive: true },
  { name: "Принтер", isActive: true },
  { name: "Сканер", isActive: true },
  { name: "Мобильный телефон", isActive: true },
  { name: "Планшет", isActive: true },
  { name: "Сервер", isActive: true },
  { name: "Сетевое оборудование", isActive: true },
  { name: "ИБП", isActive: true },
  { name: "Моноблок", isActive: true },
  { name: "SIP-телефон", isActive: true },
  // Сетевые типы для гранулярной классификации (в т.ч. модуль управления MikroTik).
  { name: "Маршрутизатор", isActive: true },
  { name: "Коммутатор", isActive: true },
  { name: "Точка доступа", isActive: true },
  { name: "Cloud Hosted Router", isActive: true },
];

// Вендоры (глобальные). Полей description/website в схеме нет — не задаём.
const initialVendors = [
  { name: "Apple", isActive: true },
  { name: "Dell", isActive: true },
  { name: "HP", isActive: true },
  { name: "Lenovo", isActive: true },
  { name: "ASUS", isActive: true },
  { name: "Samsung", isActive: true },
  { name: "Canon", isActive: true },
  { name: "Epson", isActive: true },
  { name: "Cisco", isActive: true },
  { name: MIKROTIK_VENDOR_NAME, isActive: true, isMikrotikManagementEnabled: true },
  { name: "APC", isActive: true },
  { name: "Microsoft", isActive: true },
  { name: "Acer", isActive: true },
  { name: "MSI", isActive: true },
];

async function initializeInventoryData() {
  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(
      `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
    );
    console.log("Connected to MongoDB");

    // Шаг 1: атрибуты (справочник) → карта code → _id
    console.log("\n=== Инициализация атрибутов ===");
    const attributeMap = new Map();
    for (const attributeData of initialDeviceAttributes) {
      // Ищем по code ИЛИ name: на существующих БД у deviceattributes есть
      // устаревший unique-индекс name_1, а каталог уже частично наполнен
      // (через UI) — совпадение по коду не поймает запись с тем же именем,
      // и insert упал бы на дубликате name. Записи не модифицируем.
      let attribute = await DeviceAttribute.findOne({
        $or: [{ code: attributeData.code }, { name: attributeData.name }],
      });
      if (!attribute) {
        attribute = await new DeviceAttribute(attributeData).save();
        console.log(`✓ Создан атрибут: ${attributeData.name} (${attributeData.code})`);
      } else {
        console.log(`- Атрибут уже существует: ${attributeData.name} (${attribute.code})`);
      }
      // Ключ карты — НАШ канонический code, чтобы привязки типов резолвились
      // независимо от кода существующей записи.
      attributeMap.set(attributeData.code, attribute._id);
    }

    // Шаг 2: типы устройств → карта name → _id. Запоминаем, какие типы СОЗДАНЫ
    // сейчас — только им навесим type-specific атрибуты (шаг 3a).
    console.log("\n=== Инициализация типов устройств ===");
    const typeMap = new Map();
    const createdTypeNames = new Set();
    for (const deviceTypeData of initialDeviceTypes) {
      let deviceType = await DeviceType.findOne({ name: deviceTypeData.name });
      if (!deviceType) {
        deviceType = await new DeviceType(deviceTypeData).save();
        createdTypeNames.add(deviceType.name);
        console.log(`✓ Создан тип: ${deviceTypeData.name}`);
      } else {
        console.log(`- Тип уже существует: ${deviceTypeData.name}`);
      }
      typeMap.set(deviceType.name, deviceType._id);
    }

    // Шаг 3a: type-specific атрибуты — только для ТОЛЬКО ЧТО созданных типов.
    // Уже существовавшие типы не трогаем: у них может быть свой настроенный
    // набор, и навязывание нашего дало бы дубли на наполненной БД.
    console.log("\n=== Привязка type-specific атрибутов (только для новых типов) ===");
    for (const deviceTypeData of initialDeviceTypes) {
      if (!createdTypeNames.has(deviceTypeData.name)) continue;
      const deviceTypeId = typeMap.get(deviceTypeData.name);
      const typeSpecific = deviceTypeAttributes[deviceTypeData.name] || [];
      for (const attrConfig of typeSpecific) {
        const attributeId = attributeMap.get(attrConfig.code);
        if (!attributeId) {
          console.log(`  ! Пропущен неизвестный атрибут: ${attrConfig.code}`);
          continue;
        }
        const existingLink = await DeviceTypeAttribute.findOne({
          deviceTypeId,
          attributeId,
        });
        if (!existingLink) {
          await new DeviceTypeAttribute({
            deviceTypeId,
            attributeId,
            required: attrConfig.required,
            order: attrConfig.order,
          }).save();
        }
      }
      console.log(`✓ ${deviceTypeData.name}: type-specific привязаны`);
    }

    // Шаг 3b: «Год выпуска» — обязателен для КАЖДОГО типа в БД (не только для
    // определённых сидом). Это выполняет требование «год производства везде»,
    // включая уже существующие в базе типы. Показываем В КОНЦЕ списка
    // (order = YEAR_DISPLAY_ORDER). Существующие связи апгрейдим (required + order).
    console.log("\n=== «Год выпуска» — обязателен и в конце списка для ВСЕХ типов ===");
    const yearAttrId = attributeMap.get(MANUFACTURE_YEAR_CODE);
    const allTypes = await DeviceType.find({});
    let yearAdded = 0;
    let yearFixed = 0;
    for (const t of allTypes) {
      const link = await DeviceTypeAttribute.findOne({
        deviceTypeId: t._id,
        attributeId: yearAttrId,
      });
      if (!link) {
        await new DeviceTypeAttribute({
          deviceTypeId: t._id,
          attributeId: yearAttrId,
          required: true,
          order: YEAR_DISPLAY_ORDER,
        }).save();
        yearAdded += 1;
      } else {
        let changed = false;
        if (!link.required) {
          link.required = true;
          changed = true;
        }
        if (link.order !== YEAR_DISPLAY_ORDER) {
          link.order = YEAR_DISPLAY_ORDER;
          changed = true;
        }
        if (changed) {
          await link.save();
          yearFixed += 1;
        }
      }
    }
    console.log(
      `✓ Типов всего: ${allTypes.length}; «Год выпуска» добавлен: ${yearAdded}, обновлено (required/order): ${yearFixed}`,
    );

    // Шаг 4: вендоры. Перед созданием — нормализация старого написания "Mikrotik".
    console.log("\n=== Инициализация вендоров ===");
    const legacyMikrotik = await Vendor.findOne({ name: "Mikrotik" });
    const canonicalMikrotik = await Vendor.findOne({
      name: MIKROTIK_VENDOR_NAME,
    });
    if (legacyMikrotik && !canonicalMikrotik) {
      legacyMikrotik.name = MIKROTIK_VENDOR_NAME;
      legacyMikrotik.isMikrotikManagementEnabled = true;
      await legacyMikrotik.save();
      console.log(`✓ Вендор "Mikrotik" переименован в "${MIKROTIK_VENDOR_NAME}" и включён в управление`);
    }

    for (const vendorData of initialVendors) {
      const existingVendor = await Vendor.findOne({ name: vendorData.name });
      if (!existingVendor) {
        await new Vendor(vendorData).save();
        console.log(`✓ Создан вендор: ${vendorData.name}`);
      } else {
        console.log(`- Вендор уже существует: ${vendorData.name}`);
      }
    }

    console.log("\n✅ Инициализация справочников инвентаря завершена!");
  } catch (error) {
    console.error("❌ Ошибка инициализации данных инвентаря:", error);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB");
  }
}

// Запуск при прямом вызове скрипта
if (require.main === module) {
  initializeInventoryData();
}

module.exports = {
  initializeInventoryData,
  initialDeviceAttributes,
  MIKROTIK_VENDOR_NAME,
  MANUFACTURE_YEAR_CODE,
};
