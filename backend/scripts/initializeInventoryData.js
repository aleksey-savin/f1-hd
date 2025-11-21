const mongoose = require("mongoose");
const DeviceType = require("../models/inventory/deviceType");
const Vendor = require("../models/inventory/vendor");

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
];

// Initial vendors
const initialVendors = [
  {
    name: "Apple",
    description: "Производитель компьютеров, планшетов и смартфонов",
    website: "https://www.apple.com",
    isActive: true,
  },
  {
    name: "Dell",
    description: "Производитель компьютеров и серверов",
    website: "https://www.dell.com",
    isActive: true,
  },
  {
    name: "HP",
    description: "Производитель компьютеров, принтеров и серверов",
    website: "https://www.hp.com",
    isActive: true,
  },
  {
    name: "Lenovo",
    description: "Производитель компьютеров и мобильных устройств",
    website: "https://www.lenovo.com",
    isActive: true,
  },
  {
    name: "ASUS",
    description: "Производитель компьютеров и комплектующих",
    website: "https://www.asus.com",
    isActive: true,
  },
  {
    name: "Samsung",
    description: "Производитель мониторов, принтеров и мобильных устройств",
    website: "https://www.samsung.com",
    isActive: true,
  },
  {
    name: "Canon",
    description: "Производитель принтеров и сканеров",
    website: "https://www.canon.com",
    isActive: true,
  },
  {
    name: "Epson",
    description: "Производитель принтеров и сканеров",
    website: "https://www.epson.com",
    isActive: true,
  },
  {
    name: "Cisco",
    description: "Производитель сетевого оборудования",
    website: "https://www.cisco.com",
    isActive: true,
  },
  {
    name: "Mikrotik",
    description: "Производитель сетевого оборудования",
    website: "https://mikrotik.com",
    isActive: true,
  },
  {
    name: "APC",
    description: "Производитель источников бесперебойного питания",
    website: "https://www.apc.com",
    isActive: true,
  },
  {
    name: "Microsoft",
    description: "Производитель компьютеров Surface и программного обеспечения",
    website: "https://www.microsoft.com",
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

    // Initialize device types
    console.log("Initializing device types...");
    for (const deviceTypeData of initialDeviceTypes) {
      const existingDeviceType = await DeviceType.findOne({
        name: deviceTypeData.name,
      });
      if (!existingDeviceType) {
        const deviceType = new DeviceType(deviceTypeData);
        await deviceType.save();
        console.log(`Created device type: ${deviceTypeData.name}`);
      } else {
        console.log(`Device type already exists: ${deviceTypeData.name}`);
      }
    }

    // Initialize vendors
    console.log("Initializing vendors...");
    for (const vendorData of initialVendors) {
      const existingVendor = await Vendor.findOne({ name: vendorData.name });
      if (!existingVendor) {
        const vendor = new Vendor(vendorData);
        await vendor.save();
        console.log(`Created vendor: ${vendorData.name}`);
      } else {
        console.log(`Vendor already exists: ${vendorData.name}`);
      }
    }

    console.log("Inventory data initialization completed successfully!");
  } catch (error) {
    console.error("Error initializing inventory data:", error);
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
