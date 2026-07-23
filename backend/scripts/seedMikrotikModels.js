const mongoose = require("mongoose");
const Vendor = require("../models/inventory/vendor");
const DeviceType = require("../models/inventory/deviceType");
const DeviceModel = require("../models/inventory/deviceModel");
const DeviceConfiguration = require("../models/inventory/deviceConfiguration");
const DeviceAttribute = require("../models/inventory/deviceAttribute");
const {
  initialDeviceAttributes,
  MIKROTIK_VENDOR_NAME,
  MANUFACTURE_YEAR_CODE,
} = require("./initializeInventoryData");

// Категория модели → имя типа устройства. Имена типов совпадают строкой с
// DEVICE_KIND_PATTERNS в models/mikrotik.js — иначе авто-классификация не сойдётся.
const CATEGORY_TO_TYPE = {
  router: "Маршрутизатор",
  switch: "Коммутатор",
  ap: "Точка доступа",
  chr: "Cloud Hosted Router",
};

// Атрибуты, значения которых кладём в каталожную конфигурацию модели.
const NEEDED_ATTR_CODES = [
  MANUFACTURE_YEAR_CODE,
  "portcount",
  "portspeed",
  "poesupport",
  "operatingsystem",
];

// Каталог MikroTik на июль 2026 (сверено с mikrotik.com/products и mikrosearch.com).
// portCount — суммарно проводных портов (Ethernet + SFP/QSFP); portSpeed — скорость
// самого быстрого порта в Гбит/с (400G-порты ограничены до 100 — максимум справочника
// portspeed); poe=true — устройство умеет отдавать PoE-out. year — год анонса модели,
// служит дефолтом «Года выпуска» в конфигурации (правится на экземпляре под факт).
const MIKROTIK_MODELS = [
  // --- Маршрутизаторы ---
  { name: "hEX", category: "router", year: 2016, ports: 5, portSpeed: 1, poe: false, note: "" },
  { name: "hEX S", category: "router", year: 2018, ports: 6, portSpeed: 1, poe: true, note: "5x 1G + 1x 1G SFP; passive PoE-out on port 5" },
  { name: "hEX lite", category: "router", year: 2015, ports: 5, portSpeed: 1, poe: false, note: "5x 100 Mbit Fast Ethernet (sub-gigabit)" },
  { name: "hEX PoE", category: "router", year: 2016, ports: 6, portSpeed: 1, poe: true, note: "5x 1G (PoE-out on 2-5) + 1x 1G SFP" },
  { name: "hEX PoE lite", category: "router", year: 2016, ports: 5, portSpeed: 1, poe: true, note: "5x 100 Mbit Fast Ethernet; PoE-out on ports 2-5" },
  { name: "hEX refresh", category: "router", year: 2024, ports: 5, portSpeed: 1, poe: false, note: "hEX 2024 / E50UG" },
  { name: "RB4011iGS+RM", category: "router", year: 2018, ports: 11, portSpeed: 10, poe: true, note: "10x 1G + 1x 10G SFP+; passive PoE-out on Ether10" },
  { name: "RB1100AHx4", category: "router", year: 2017, ports: 13, portSpeed: 1, poe: false, note: "13x Gigabit Ethernet" },
  { name: "RB5009UG+S+IN", category: "router", year: 2021, ports: 9, portSpeed: 10, poe: false, note: "1x 2.5G + 7x 1G + 1x 10G SFP+; PoE-in only" },
  { name: "RB5009UPr+S+IN", category: "router", year: 2022, ports: 9, portSpeed: 10, poe: true, note: "PoE-out on all 8 Ethernet ports; 1x 10G SFP+" },
  { name: "RB5009UPr+S+OUT", category: "router", year: 2023, ports: 9, portSpeed: 10, poe: true, note: "outdoor; PoE-out on 8 Ethernet ports; 1x 10G SFP+" },
  { name: "L009UiGS-RM", category: "router", year: 2022, ports: 9, portSpeed: 2.5, poe: true, note: "8x 1G + 1x 2.5G SFP; PoE-out on Ether8" },
  { name: "PowerBox Pro", category: "router", year: 2017, ports: 6, portSpeed: 1, poe: true, note: "outdoor; 5x 1G (PoE-out on 2-5) + 1x 1G SFP" },
  { name: "CCR2004-1G-12S+2XS", category: "router", year: 2020, ports: 15, portSpeed: 25, poe: false, note: "1x 1G + 12x 10G SFP+ + 2x 25G SFP28" },
  { name: "CCR2004-16G-2S+", category: "router", year: 2021, ports: 18, portSpeed: 10, poe: false, note: "16x 1G + 2x 10G SFP+" },
  { name: "CCR2116-12G-4S+", category: "router", year: 2021, ports: 17, portSpeed: 10, poe: false, note: "13x 1G + 4x 10G SFP+" },
  { name: "CCR2216-1G-12XS-2XQ", category: "router", year: 2022, ports: 15, portSpeed: 100, poe: false, note: "1x 1G + 12x 25G SFP28 + 2x 100G QSFP28" },
  { name: "hAP ax²", category: "router", year: 2022, ports: 5, portSpeed: 1, poe: true, note: "5x 1G; passive PoE-out on Ether1" },
  { name: "hAP ax³", category: "router", year: 2022, ports: 5, portSpeed: 2.5, poe: true, note: "1x 2.5G (passive PoE in/out) + 4x 1G" },
  { name: "hAP ax lite", category: "router", year: 2023, ports: 4, portSpeed: 1, poe: false, note: "single-band 2.4 GHz Wi-Fi 6; L41G-2axD" },
  { name: "hAP be³ Media", category: "router", year: 2025, ports: 5, portSpeed: 2.5, poe: false, note: "Wi-Fi 7 tri-band; 5x 2.5G, PoE-in only" },
  { name: "hAP be lite", category: "router", year: 2025, ports: 4, portSpeed: 2.5, poe: false, note: "Wi-Fi 7 dual-band; 3x 1G + 1x 2.5G; year approximate (~2025-2026)" },
  { name: "Chateau LTE7 ax", category: "router", year: 2025, ports: 5, portSpeed: 2.5, poe: false, note: "LTE + Wi-Fi 6 CPE; 4x 1G + 1x 2.5G; year approximate" },

  // --- Коммутаторы ---
  { name: "CRS106-1C-5S", category: "switch", year: 2016, ports: 6, portSpeed: 1, poe: false, note: "1 combo + 5x 1G SFP" },
  { name: "CRS112-8P-4S-IN", category: "switch", year: 2016, ports: 12, portSpeed: 1, poe: true, note: "8x 1G PoE-out + 4x 1G SFP" },
  { name: "CRS304-4XG-IN", category: "switch", year: 2024, ports: 4, portSpeed: 10, poe: false, note: "4x 10G RJ45 (10GBASE-T); launched Oct 2024" },
  { name: "CRS305-1G-4S+IN", category: "switch", year: 2019, ports: 5, portSpeed: 10, poe: false, note: "1x 1G + 4x 10G SFP+" },
  { name: "CRS309-1G-8S+IN", category: "switch", year: 2018, ports: 9, portSpeed: 10, poe: false, note: "1x 1G + 8x 10G SFP+" },
  { name: "CRS310-8G+2S+IN", category: "switch", year: 2023, ports: 10, portSpeed: 10, poe: false, note: "8x 2.5G + 2x 10G SFP+" },
  { name: "CRS310-1G-5S-4S+IN", category: "switch", year: 2022, ports: 10, portSpeed: 10, poe: false, note: "1x 1G + 5x 1G SFP + 4x 10G SFP+" },
  { name: "CRS312-4C+8XG-RM", category: "switch", year: 2019, ports: 12, portSpeed: 10, poe: false, note: "4 combo (10G SFP+/10GBASE-T) + 8x 10G RJ45" },
  { name: "CRS317-1G-16S+RM", category: "switch", year: 2017, ports: 17, portSpeed: 10, poe: false, note: "1x 1G + 16x 10G SFP+" },
  { name: "CRS320-8P-8B-4S+RM", category: "switch", year: 2024, ports: 21, portSpeed: 10, poe: true, note: "16x 1G PoE (8 af/at + 8 bt PoE++) + 1x 1G mgmt + 4x 10G SFP+" },
  { name: "CRS326-24G-2S+IN", category: "switch", year: 2019, ports: 26, portSpeed: 10, poe: false, note: "24x 1G + 2x 10G SFP+" },
  { name: "CRS326-24G-2S+RM", category: "switch", year: 2016, ports: 26, portSpeed: 10, poe: false, note: "24x 1G + 2x 10G SFP+" },
  { name: "CRS326-24S+2Q+RM", category: "switch", year: 2020, ports: 26, portSpeed: 40, poe: false, note: "24x 10G SFP+ + 2x 40G QSFP+" },
  { name: "CRS328-24P-4S+RM", category: "switch", year: 2018, ports: 28, portSpeed: 10, poe: true, note: "24x 1G PoE-out + 4x 10G SFP+" },
  { name: "CRS354-48G-4S+2Q+RM", category: "switch", year: 2019, ports: 54, portSpeed: 40, poe: false, note: "48x 1G + 4x 10G SFP+ + 2x 40G QSFP+" },
  { name: "CRS354-48P-4S+2Q+RM", category: "switch", year: 2019, ports: 54, portSpeed: 40, poe: true, note: "48x 1G PoE-out + 4x 10G SFP+ + 2x 40G QSFP+" },
  { name: "CRS504-4XQ-IN", category: "switch", year: 2021, ports: 4, portSpeed: 100, poe: false, note: "4x 100G QSFP28" },
  { name: "CRS510-8XS-2XQ-IN", category: "switch", year: 2023, ports: 10, portSpeed: 100, poe: false, note: "8x 25G SFP28 + 2x 100G QSFP28" },
  { name: "CRS518-16XS-2XQ-RM", category: "switch", year: 2022, ports: 18, portSpeed: 100, poe: false, note: "16x 25G SFP28 + 2x 100G QSFP28" },
  { name: "CRS520-4XS-16XQ-RM", category: "switch", year: 2023, ports: 20, portSpeed: 100, poe: false, note: "4x 25G SFP28 + 16x 100G QSFP28" },
  { name: "CRS804 DDQ", category: "switch", year: 2026, ports: 6, portSpeed: 100, poe: false, note: "2x 10G + 4x 400G QSFP56-DD; fastest ports 400G, capped to 100 (max enum); announced Jan 2026" },
  { name: "CRS812 DDQ", category: "switch", year: 2025, ports: 14, portSpeed: 100, poe: false, note: "2x 10G + 8x 50G SFP56 + 2x 200G QSFP56 + 2x 400G QSFP56-DD; fastest 400G, capped to 100" },
  { name: "CSS318-16G-2S+IN", category: "switch", year: 2018, ports: 18, portSpeed: 10, poe: false, note: "16x 1G + 2x 10G SFP+; SwOS" },
  { name: "CSS326-24G-2S+RM", category: "switch", year: 2017, ports: 26, portSpeed: 10, poe: false, note: "24x 1G + 2x 10G SFP+; SwOS" },
  { name: "CSS610-8G-2S+IN", category: "switch", year: 2020, ports: 10, portSpeed: 10, poe: false, note: "8x 1G + 2x 10G SFP+" },
  { name: "CSS610-8P-2S+IN", category: "switch", year: 2020, ports: 10, portSpeed: 10, poe: true, note: "8x 1G PoE-out + 2x 10G SFP+" },
  { name: "netPower 16P", category: "switch", year: 2020, ports: 18, portSpeed: 10, poe: true, note: "16x 1G PoE-out + 2x 10G SFP+; outdoor" },
  { name: "netPower 15FR", category: "switch", year: 2020, ports: 18, portSpeed: 1, poe: true, note: "16x 100 Mbit FE + 2x 1G SFP (SFP fastest); reverse-PoE-in with PoE-out passthrough" },
  { name: "netPower Lite 7R", category: "switch", year: 2021, ports: 10, portSpeed: 10, poe: true, note: "8x 1G + 2x 10G SFP+; reverse-PoE-in, PoE-out on Ether8" },
  { name: "netPower Lite 8P", category: "switch", year: 2025, ports: 10, portSpeed: 10, poe: true, note: "8x 1G PoE-out (802.3af/at) + 2x 10G SFP+; CSS610-8P-2S+OUT" },
  { name: "RB260GS", category: "switch", year: 2013, ports: 6, portSpeed: 1, poe: false, note: "5x 1G + 1x 1G SFP; SwOS; year approximate" },
  { name: "RB260GSP", category: "switch", year: 2014, ports: 6, portSpeed: 1, poe: true, note: "5x 1G (PoE-out on 2-5) + 1x 1G SFP; SwOS; year approximate" },

  // --- Точки доступа ---
  { name: "cAP ax", category: "ap", year: 2022, ports: 2, portSpeed: 1, poe: true, note: "2x 1G; passive PoE-out on Ether2" },
  { name: "cAP ac", category: "ap", year: 2017, ports: 2, portSpeed: 1, poe: true, note: "2x 1G; passive PoE-out on Ether2" },
  { name: "cAP XL ac", category: "ap", year: 2021, ports: 2, portSpeed: 1, poe: true, note: "2x 1G; passive PoE-out on Ether2" },
  { name: "wAP ac", category: "ap", year: 2016, ports: 2, portSpeed: 1, poe: false, note: "2x 1G; PoE-in only" },
  { name: "wAP ax", category: "ap", year: 2023, ports: 2, portSpeed: 1, poe: false, note: "2x 1G; PoE-in only; year approximate" },
  { name: "wAP 60G", category: "ap", year: 2017, ports: 1, portSpeed: 1, poe: false, note: "60 GHz (802.11ad); 1x 1G" },
  { name: "Audience", category: "ap", year: 2019, ports: 2, portSpeed: 1, poe: false, note: "2x 1G; PoE-in" },
  { name: "SXTsq 5 ac", category: "ap", year: 2017, ports: 1, portSpeed: 1, poe: false, note: "1x Gigabit Ethernet" },
  { name: "SXTsq 5 ax", category: "ap", year: 2023, ports: 1, portSpeed: 1, poe: false, note: "1x Gigabit Ethernet" },
  { name: "SXTsq Lite2", category: "ap", year: 2018, ports: 1, portSpeed: 1, poe: false, note: "100 Mbit Fast Ethernet" },
  { name: "SXTsq Lite5", category: "ap", year: 2017, ports: 1, portSpeed: 1, poe: false, note: "100 Mbit Fast Ethernet" },
  { name: "LHG 5", category: "ap", year: 2016, ports: 1, portSpeed: 1, poe: false, note: "100 Mbit Fast Ethernet" },
  { name: "LHG 5 ax", category: "ap", year: 2025, ports: 1, portSpeed: 1, poe: false, note: "1x Gigabit Ethernet" },
  { name: "LHG XL 5 ax", category: "ap", year: 2025, ports: 1, portSpeed: 1, poe: false, note: "1x Gigabit Ethernet" },
  { name: "LHG XL HP5", category: "ap", year: 2017, ports: 1, portSpeed: 1, poe: false, note: "100 Mbit Fast Ethernet" },
  { name: "LDF 5", category: "ap", year: 2016, ports: 1, portSpeed: 1, poe: false, note: "100 Mbit Fast Ethernet" },
  { name: "Groove 52", category: "ap", year: 2012, ports: 1, portSpeed: 1, poe: false, note: "100 Mbit Fast Ethernet; year approximate" },
  { name: "GrooveA 52", category: "ap", year: 2012, ports: 1, portSpeed: 1, poe: false, note: "100 Mbit Fast Ethernet; year approximate" },
  { name: "BaseBox 5", category: "ap", year: 2014, ports: 1, portSpeed: 1, poe: false, note: "1x Gigabit Ethernet; year approximate" },
  { name: "NetMetal 5", category: "ap", year: 2014, ports: 2, portSpeed: 1, poe: false, note: "1x 1G Ethernet + 1x 1G SFP" },
  { name: "NetMetal ax", category: "ap", year: 2024, ports: 2, portSpeed: 2.5, poe: false, note: "1x 1G Ethernet + 1x 2.5G SFP (fastest port)" },
  { name: "NetBox 5 ax", category: "ap", year: 2024, ports: 1, portSpeed: 1, poe: false, note: "1x Gigabit Ethernet only, no SFP; PoE-in" },
  { name: "OmniTIK 5 PoE ac", category: "ap", year: 2016, ports: 5, portSpeed: 1, poe: true, note: "5x 1G; PoE-out passthrough on ports 2-5" },
  { name: "mANTBox 2 12s", category: "ap", year: 2018, ports: 1, portSpeed: 1, poe: false, note: "1x Gigabit Ethernet, no SFP" },
  { name: "mANTBox ax 15s", category: "ap", year: 2024, ports: 2, portSpeed: 2.5, poe: false, note: "1x 1G Ethernet + 1x 2.5G SFP (fastest port)" },
  { name: "QRT 5", category: "ap", year: 2014, ports: 1, portSpeed: 1, poe: false, note: "1x Gigabit Ethernet; year approximate" },
  { name: "Metal 52 ac", category: "ap", year: 2017, ports: 1, portSpeed: 1, poe: false, note: "1x Gigabit Ethernet, no SFP; year approximate" },

  // --- Cloud Hosted Router ---
  { name: "CHR", category: "chr", year: 2015, ports: 0, portSpeed: 0, poe: false, note: "Cloud Hosted Router; virtual/software RouterOS, ports depend on host" },
];

// findOne-or-create для вендора MikroTik (обязателен флаг управления).
async function ensureVendor() {
  let vendor = await Vendor.findOne({ name: MIKROTIK_VENDOR_NAME });
  if (!vendor) {
    vendor = await new Vendor({
      name: MIKROTIK_VENDOR_NAME,
      isActive: true,
      isMikrotikManagementEnabled: true,
    }).save();
    console.log(`✓ Создан вендор ${MIKROTIK_VENDOR_NAME}`);
  } else if (!vendor.isMikrotikManagementEnabled) {
    vendor.isMikrotikManagementEnabled = true;
    await vendor.save();
    console.log(`✓ Вендору ${MIKROTIK_VENDOR_NAME} включён флаг управления`);
  }
  return vendor._id;
}

// findOne-or-create для типов устройств (4 сетевых). Возвращает Map name → _id.
async function ensureTypes() {
  const typeMap = new Map();
  for (const typeName of Object.values(CATEGORY_TO_TYPE)) {
    let type = await DeviceType.findOne({ name: typeName });
    if (!type) {
      type = await new DeviceType({ name: typeName, isActive: true }).save();
      console.log(`✓ Создан тип: ${typeName}`);
    }
    typeMap.set(typeName, type._id);
  }
  return typeMap;
}

// findOne-or-create для нужных атрибутов. Определения берём из initializeInventoryData
// (единый источник), чтобы не дублировать опции. Возвращает Map code → _id.
async function ensureAttributes() {
  const attrMap = new Map();
  for (const code of NEEDED_ATTR_CODES) {
    const def =
      initialDeviceAttributes.find((a) => a.code === code) || {
        code,
        name: code,
        valueType: "string",
      };
    // По code ИЛИ name — см. пояснение в initializeInventoryData (устаревший
    // unique-индекс name_1 на существующих БД). Записи не модифицируем.
    let attr = await DeviceAttribute.findOne({
      $or: [{ code }, { name: def.name }],
    });
    if (!attr) {
      attr = await new DeviceAttribute(def).save();
      console.log(`✓ Создан атрибут: ${def.name} (${code})`);
    }
    attrMap.set(code, attr._id);
  }
  return attrMap;
}

// Значения конфигурации модели (code → строковое значение). Для CHR — только год + ОС.
function buildValueCodes(model) {
  const values = [{ code: MANUFACTURE_YEAR_CODE, value: String(model.year) }];
  if (model.category === "chr") {
    values.push({ code: "operatingsystem", value: "routeros" });
  } else {
    if (model.ports > 0) {
      values.push({ code: "portcount", value: String(model.ports) });
    }
    if (model.portSpeed > 0) {
      values.push({ code: "portspeed", value: String(model.portSpeed) });
    }
    values.push({ code: "poesupport", value: String(model.poe) });
  }
  return values;
}

async function seedMikrotikModels() {
  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(
      `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
    );
    console.log("Connected to MongoDB");

    const vendorId = await ensureVendor();
    const typeMap = await ensureTypes();
    const attrMap = await ensureAttributes();

    console.log("\n=== Инициализация моделей MikroTik ===");
    let createdModels = 0;
    let createdConfigs = 0;

    for (const model of MIKROTIK_MODELS) {
      const typeName = CATEGORY_TO_TYPE[model.category];
      const deviceTypeId = typeMap.get(typeName);
      if (!deviceTypeId) {
        console.log(`  ! Пропущена модель ${model.name}: нет типа "${typeName}"`);
        continue;
      }

      // Модель (идемпотентно по имени + вендор, только не удалённые)
      let deviceModel = await DeviceModel.findOne({
        name: model.name,
        vendorId,
        deletedAt: null,
      });
      if (!deviceModel) {
        deviceModel = await new DeviceModel({
          name: model.name,
          deviceTypeId,
          vendorId,
          notes: model.note || undefined,
        }).save();
        createdModels += 1;
        console.log(`✓ Модель: ${model.name} → ${typeName}`);
      }

      // Каталожная конфигурация (одна на модель, идемпотентно)
      const existingConfig = await DeviceConfiguration.findOne({
        deviceModelId: deviceModel._id,
        deletedAt: null,
      });
      if (!existingConfig) {
        const values = buildValueCodes(model)
          .map((v) => ({ attributeId: attrMap.get(v.code), value: v.value }))
          .filter((v) => v.attributeId);
        await new DeviceConfiguration({
          name: model.name,
          deviceModelId: deviceModel._id,
          values,
        }).save();
        createdConfigs += 1;
      }
    }

    console.log(
      `\n✅ Готово. Моделей всего: ${MIKROTIK_MODELS.length} (создано новых: ${createdModels}); конфигураций создано: ${createdConfigs}.`,
    );
  } catch (error) {
    console.error("❌ Ошибка сидирования моделей MikroTik:", error);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB");
  }
}

// Запуск при прямом вызове скрипта
if (require.main === module) {
  seedMikrotikModels();
}

module.exports = { seedMikrotikModels, MIKROTIK_MODELS };
