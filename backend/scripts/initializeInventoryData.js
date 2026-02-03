const mongoose = require("mongoose");
const DeviceType = require("../models/inventory/deviceType");
const Vendor = require("../models/inventory/vendor");
const DeviceAttribute = require("../models/inventory/deviceAttribute");

// Initial device attributes
const initialDeviceAttributes = [
  // Common attributes
  {
    name: "ram",
    label: "Оперативная память",
    description: "Объем оперативной памяти",
    dataType: "select",
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
    name: "storage",
    label: "Накопитель",
    description: "Объем накопителя",
    dataType: "select",
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
    name: "processor",
    label: "Процессор",
    description: "Модель процессора",
    dataType: "string",
  },
  {
    name: "graphics",
    label: "Видеокарта",
    description: "Модель видеокарты",
    dataType: "string",
  },
  {
    name: "screenSize",
    label: "Диагональ экрана",
    description: "Размер экрана",
    dataType: "select",
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
    name: "resolution",
    label: "Разрешение экрана",
    description: "Разрешение дисплея",
    dataType: "select",
    options: [
      { value: "1920x1080", label: "Full HD (1920x1080)" },
      { value: "2560x1440", label: "QHD (2560x1440)" },
      { value: "3840x2160", label: "4K (3840x2160)" },
    ],
  },
  {
    name: "ports",
    label: "Порты",
    description: "Доступные порты и разъемы",
    dataType: "text",
  },
  {
    name: "powerSupply",
    label: "Блок питания",
    description: "Мощность блока питания",
    dataType: "string",
    unit: "Вт",
  },
  // Server specific
  {
    name: "rackUnits",
    label: "Высота в юнитах",
    description: "Высота серверной стойки",
    dataType: "select",
    unit: "U",
    options: [
      { value: "1", label: "1U" },
      { value: "2", label: "2U" },
      { value: "4", label: "4U" },
    ],
  },
  {
    name: "cpuSockets",
    label: "Количество сокетов ЦП",
    description: "Число процессорных сокетов",
    dataType: "select",
    options: [
      { value: "1", label: "1 сокет" },
      { value: "2", label: "2 сокета" },
      { value: "4", label: "4 сокета" },
    ],
  },
  // Printer specific
  {
    name: "printTechnology",
    label: "Технология печати",
    description: "Тип технологии печати",
    dataType: "select",
    options: [
      { value: "laser", label: "Лазерная" },
      { value: "inkjet", label: "Струйная" },
      { value: "thermal", label: "Термическая" },
    ],
  },
  {
    name: "printSpeed",
    label: "Скорость печати",
    description: "Страниц в минуту",
    dataType: "number",
    unit: "стр/мин",
  },
  {
    name: "colorPrinting",
    label: "Цветная печать",
    description: "Поддержка цветной печати",
    dataType: "boolean",
  },
  // Network equipment
  {
    name: "portCount",
    label: "Количество портов",
    description: "Число сетевых портов",
    dataType: "number",
  },
  {
    name: "portSpeed",
    label: "Скорость портов",
    description: "Максимальная скорость портов",
    dataType: "select",
    unit: "Гбит/с",
    options: [
      { value: "1", label: "1 Гбит/с" },
      { value: "10", label: "10 Гбит/с" },
      { value: "25", label: "25 Гбит/с" },
      { value: "40", label: "40 Гбит/с" },
      { value: "100", label: "100 Гбит/с" },
    ],
  },
  {
    name: "poeSupport",
    label: "Поддержка PoE",
    description: "Питание по Ethernet",
    dataType: "boolean",
  },
  // UPS specific
  {
    name: "upsPower",
    label: "Мощность ИБП",
    description: "Номинальная мощность",
    dataType: "number",
    unit: "ВА",
  },
  {
    name: "batteryRuntime",
    label: "Время автономной работы",
    description: "Время работы от батареи",
    dataType: "number",
    unit: "мин",
  },
  // Mobile devices
  {
    name: "operatingSystem",
    label: "Операционная система",
    description: "ОС устройства",
    dataType: "select",
    options: [
      { value: "ios", label: "iOS" },
      { value: "android", label: "Android" },
      { value: "windows", label: "Windows" },
      { value: "macos", label: "macOS" },
      { value: "linux", label: "Linux" },
    ],
  },
  {
    name: "batteryCapacity",
    label: "Емкость батареи",
    description: "Емкость аккумулятора",
    dataType: "number",
    unit: "мАч",
  },
];

// Device type to attribute mapping
const deviceTypeAttributes = {
  Ноутбук: [
    { name: "processor", isRequired: true, displayOrder: 1 },
    { name: "ram", isRequired: true, displayOrder: 2 },
    { name: "storage", isRequired: true, displayOrder: 3 },
    { name: "graphics", isRequired: false, displayOrder: 4 },
    { name: "screenSize", isRequired: false, displayOrder: 5 },
    { name: "resolution", isRequired: false, displayOrder: 6 },
    { name: "operatingSystem", isRequired: false, displayOrder: 7 },
    { name: "batteryCapacity", isRequired: false, displayOrder: 8 },
  ],
  "Настольный компьютер": [
    { name: "processor", isRequired: true, displayOrder: 1 },
    { name: "ram", isRequired: true, displayOrder: 2 },
    { name: "storage", isRequired: true, displayOrder: 3 },
    { name: "graphics", isRequired: false, displayOrder: 4 },
    { name: "powerSupply", isRequired: false, displayOrder: 5 },
    { name: "operatingSystem", isRequired: false, displayOrder: 6 },
  ],
  Монитор: [
    { name: "screenSize", isRequired: true, displayOrder: 1 },
    { name: "resolution", isRequired: true, displayOrder: 2 },
    { name: "ports", isRequired: false, displayOrder: 3 },
  ],
  Принтер: [
    { name: "printTechnology", isRequired: true, displayOrder: 1 },
    { name: "colorPrinting", isRequired: false, displayOrder: 2 },
    { name: "printSpeed", isRequired: false, displayOrder: 3 },
  ],
  Сканер: [{ name: "resolution", isRequired: false, displayOrder: 1 }],
  "Мобильный телефон": [
    { name: "operatingSystem", isRequired: true, displayOrder: 1 },
    { name: "ram", isRequired: false, displayOrder: 2 },
    { name: "storage", isRequired: false, displayOrder: 3 },
    { name: "batteryCapacity", isRequired: false, displayOrder: 4 },
    { name: "simCount", isRequired: false, displayOrder: 5 },
  ],
  Планшет: [
    { name: "operatingSystem", isRequired: true, displayOrder: 1 },
    { name: "ram", isRequired: false, displayOrder: 2 },
    { name: "storage", isRequired: false, displayOrder: 3 },
    { name: "screenSize", isRequired: false, displayOrder: 4 },
    { name: "batteryCapacity", isRequired: false, displayOrder: 5 },
  ],
  Сервер: [
    { name: "processor", isRequired: true, displayOrder: 1 },
    { name: "cpuSockets", isRequired: false, displayOrder: 2 },
    { name: "ram", isRequired: true, displayOrder: 3 },
    { name: "storage", isRequired: true, displayOrder: 4 },
    { name: "rackUnits", isRequired: false, displayOrder: 5 },
    { name: "powerSupply", isRequired: false, displayOrder: 6 },
  ],
  "Сетевое оборудование": [
    { name: "portCount", isRequired: false, displayOrder: 1 },
    { name: "portSpeed", isRequired: false, displayOrder: 2 },
    { name: "poeSupport", isRequired: false, displayOrder: 3 },
    { name: "powerSupply", isRequired: false, displayOrder: 4 },
  ],
  ИБП: [
    { name: "upsPower", isRequired: true, displayOrder: 1 },
    { name: "batteryRuntime", isRequired: false, displayOrder: 2 },
  ],
  Моноблок: [
    { name: "processor", isRequired: true, displayOrder: 1 },
    { name: "ram", isRequired: true, displayOrder: 2 },
    { name: "storage", isRequired: true, displayOrder: 3 },
    { name: "graphics", isRequired: false, displayOrder: 4 },
    { name: "screenSize", isRequired: false, displayOrder: 5 },
    { name: "resolution", isRequired: false, displayOrder: 6 },
    { name: "operatingSystem", isRequired: false, displayOrder: 7 },
  ],
  "SIP-телефон": [
    { name: "portCount", isRequired: false, displayOrder: 1 },
    { name: "poeSupport", isRequired: false, displayOrder: 2 },
  ],
};

// Initial device types
const initialDeviceTypes = [
  {
    name: "Ноутбук",
    description: "Портативные компьютеры для работы сотрудников",
    isActive: true,
  },
  {
    name: "Настольный компьютер",
    description: "Стационарные рабочие станции",
    isActive: true,
  },
  {
    name: "Монитор",
    description: "Внешние дисплеи для компьютеров",
    isActive: true,
  },
  {
    name: "Принтер",
    description: "Устройства для печати документов",
    isActive: true,
  },
  {
    name: "Сканер",
    description: "Устройства для сканирования документов",
    isActive: true,
  },
  {
    name: "Мобильный телефон",
    description: "Корпоративные мобильные устройства",
    isActive: true,
  },
  {
    name: "Планшет",
    description: "Планшетные компьютеры",
    isActive: true,
  },
  {
    name: "Сервер",
    description: "Серверное оборудование",
    isActive: true,
  },
  {
    name: "Сетевое оборудование",
    description: "Роутеры, коммутаторы, точки доступа",
    isActive: true,
  },
  {
    name: "ИБП",
    description: "Источники бесперебойного питания",
    isActive: true,
  },
  {
    name: "Моноблок",
    description: "Компьютеры со встроенным монитором",
    isActive: true,
  },
  {
    name: "SIP-телефон",
    description: "IP-телефоны для VoIP связи",
    isActive: true,
  },
];

// Initial vendors (English)
const initialVendors = [
  {
    name: "Apple",
    description: "Computer, tablet and smartphone manufacturer",
    website: "https://www.apple.com",
    isActive: true,
  },
  {
    name: "Dell",
    description: "Computer and server manufacturer",
    website: "https://www.dell.com",
    isActive: true,
  },
  {
    name: "HP",
    description: "Computer, printer and server manufacturer",
    website: "https://www.hp.com",
    isActive: true,
  },
  {
    name: "Lenovo",
    description: "Computer and mobile device manufacturer",
    website: "https://www.lenovo.com",
    isActive: true,
  },
  {
    name: "ASUS",
    description: "Computer and component manufacturer",
    website: "https://www.asus.com",
    isActive: true,
  },
  {
    name: "Samsung",
    description: "Monitor, printer and mobile device manufacturer",
    website: "https://www.samsung.com",
    isActive: true,
  },
  {
    name: "Canon",
    description: "Printer and scanner manufacturer",
    website: "https://www.canon.com",
    isActive: true,
  },
  {
    name: "Epson",
    description: "Printer and scanner manufacturer",
    website: "https://www.epson.com",
    isActive: true,
  },
  {
    name: "Cisco",
    description: "Network equipment manufacturer",
    website: "https://www.cisco.com",
    isActive: true,
  },
  {
    name: "Mikrotik",
    description: "Network equipment manufacturer",
    website: "https://mikrotik.com",
    isActive: true,
  },
  {
    name: "APC",
    description: "UPS manufacturer",
    website: "https://www.apc.com",
    isActive: true,
  },
  {
    name: "Microsoft",
    description: "Surface computer and software manufacturer",
    website: "https://www.microsoft.com",
    isActive: true,
  },
  {
    name: "Acer",
    description: "Computer and monitor manufacturer",
    website: "https://www.acer.com",
    isActive: true,
  },
  {
    name: "MSI",
    description: "Computer and component manufacturer",
    website: "https://www.msi.com",
    isActive: true,
  },
];

async function initializeInventoryData() {
  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(
      `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
    );
    console.log("Connected to MongoDB");

    // Step 1: Initialize device attributes
    console.log("\n=== Initializing device attributes ===");
    const attributeMap = new Map();
    for (const attributeData of initialDeviceAttributes) {
      const existingAttribute = await DeviceAttribute.findOne({
        name: attributeData.name,
      });
      if (!existingAttribute) {
        const attribute = new DeviceAttribute(attributeData);
        await attribute.save();
        attributeMap.set(attribute.name, attribute._id);
        console.log(`✓ Created attribute: ${attributeData.label}`);
      } else {
        attributeMap.set(existingAttribute.name, existingAttribute._id);
        console.log(`- Attribute already exists: ${attributeData.label}`);
      }
    }

    // Step 2: Initialize device types with attributes
    console.log("\n=== Initializing device types ===");
    for (const deviceTypeData of initialDeviceTypes) {
      const existingDeviceType = await DeviceType.findOne({
        name: deviceTypeData.name,
      });

      if (!existingDeviceType) {
        // Get attributes for this device type
        const attributesConfig =
          deviceTypeAttributes[deviceTypeData.name] || [];
        const attributes = attributesConfig
          .map((attrConfig) => ({
            attributeId: attributeMap.get(attrConfig.name),
            isRequired: attrConfig.isRequired,
            displayOrder: attrConfig.displayOrder,
          }))
          .filter((attr) => attr.attributeId); // Filter out undefined attributeIds

        const deviceType = new DeviceType({
          ...deviceTypeData,
          attributes,
        });
        await deviceType.save();
        console.log(
          `✓ Created device type: ${deviceTypeData.name} (${attributes.length} attributes)`,
        );
      } else {
        console.log(`- Device type already exists: ${deviceTypeData.name}`);
      }
    }

    // Step 3: Initialize vendors
    console.log("\n=== Initializing vendors ===");
    for (const vendorData of initialVendors) {
      const existingVendor = await Vendor.findOne({ name: vendorData.name });
      if (!existingVendor) {
        const vendor = new Vendor(vendorData);
        await vendor.save();
        console.log(`✓ Created vendor: ${vendorData.name}`);
      } else {
        console.log(`- Vendor already exists: ${vendorData.name}`);
      }
    }

    console.log("\n✅ Inventory data initialization completed successfully!");
  } catch (error) {
    console.error("❌ Error initializing inventory data:", error);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB");
  }
}

// Run the script if called directly
if (require.main === module) {
  initializeInventoryData();
}

module.exports = { initializeInventoryData };
