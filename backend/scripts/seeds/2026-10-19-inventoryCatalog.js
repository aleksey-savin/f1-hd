/**
 * Первый сид каталога инвентаря (спека «Инвентарь: группы характеристик…»,
 * приложение A): группы атрибутов, типы комплектующих, заводские типы и
 * «Системный блок» для брендовых моделей — с атрибутами и группами связок.
 * Слоты и ключевые характеристики сюда не входят (это проект 2).
 *
 * Пишет services/inventory/catalogSeed (только добавляет, существующее
 * подхватывает). Подхват на уже наполненных базах:
 *   • по имени: «Тип памяти», «Сокет», «Чипсет», «Диагональ экрана», «Год
 *     релиза», «Wi-Fi» и «Сетевой интерфейс» (у МФУ);
 *   • по коду — атрибуты, заведённые вручную под другим написанием:
 *     `ram_value` («Объем оперативной памяти»), `ram_slots` («Количество
 *     слотов для оперативной памяти»), `ram_max_value` («Максимальный объем
 *     памяти»), `ramformfactor` («Форм-фактор оперативной памяти»);
 *   • `portspeed` — тот же код, что в seedMikrotikModels.js: кто бы ни пришёл
 *     первым, второй подхватит тот же атрибут. Значения «Скорости портов» —
 *     числа в Гбит/с; здесь перечислены все, что пишет сид MikroTik (1, 2.5,
 *     10, 25, 40, 100), плюс 0.1 = 100 Мбит/с;
 *   • `operatingsystem` — строка уровня устройства (с 2026-10-29 её же
 *     подхватывает сид 2026-10-29-deviceSystemAttributes).
 * «Тип оперативной памяти» (`ram_type`) не подхватывается: у каталога свой
 * «Тип памяти». ОЗУ маршрутизатора в мегабайтах — отдельный атрибут «Объём
 * ОЗУ»: имя «Объём оперативной памяти» уже занято гигабайтным, а имена
 * атрибутов уникальны.
 */
const { applyCatalog } = require("../../services/inventory/catalogSeed");

const GROUP_NAMES = [
  ["factory", "Заводские данные"],
  ["general", "Общие параметры"],
  ["software", "Программное обеспечение"],
  ["screen", "Экран"],
  ["cpu", "Процессор"],
  ["motherboard", "Материнская плата"],
  ["memory", "Оперативная память"],
  ["gpu", "Видеокарта"],
  ["storage", "Накопители данных"],
  ["ports", "Порты"],
  ["front", "Разъёмы на фронтальной панели"],
  ["connectors", "Разъёмы и интерфейсы"],
  ["network", "Сеть"],
  ["wireless", "Беспроводная сеть"],
  ["poe", "PoE"],
  ["switching", "Коммутация"],
  ["print", "Печать"],
  ["scan", "Сканирование"],
  ["copy", "Копирование"],
  ["consumables", "Расходные материалы"],
  ["power", "Питание"],
  ["cooling", "Охлаждение"],
  ["extra", "Дополнительная информация"],
  ["dimensions", "Габариты и вес"],
];

const groups = GROUP_NAMES.map(([key, name], order) => ({ key, name, order }));

// Конструкторы атрибутов: (ключ каталога, код, имя, единица | варианты)
const str = (key, code, name, unit) => ({
  key,
  code,
  name,
  valueType: "string",
  ...(unit && { unit }),
});
const num = (key, code, name, unit) => ({
  key,
  code,
  name,
  valueType: "number",
  ...(unit && { unit }),
});
const bool = (key, code, name) => ({ key, code, name, valueType: "boolean" });
const sel = (key, code, name, options, unit) => ({
  key, code, name, valueType: "select", options, ...(unit && { unit }),
});
const msel = (key, code, name, options) => ({ key, code, name, valueType: "multiselect", options });

const SOCKETS = ["AM4", "AM5", "LGA1200", "LGA1700", "LGA1851"];

const attributes = [
  // Общие параметры и ПО
  str("line", "product_line", "Линейка"),
  num("releaseYear", "release_year", "Год релиза"),
  str("color", "color", "Цвет"),
  sel("caseFormFactor", "case_form_factor", "Форм-фактор корпуса", [
    "Mini-Tower", "Mid-Tower", "Full-Tower", "Desktop", "SFF",
  ]),
  sel("mounting", "mounting", "Исполнение", ["настольное", 'стоечное 19"', "настенное"]),
  str("preinstalledOs", "preinstalled_os", "Предустановленная ОС"),
  // Своя у каждого устройства (системный атрибут, services/inventory/systemDeviceAttributes)
  { ...str("os", "operatingsystem", "Операционная система"), scope: "device" },
  str("licenseLevel", "license_level", "Уровень лицензии"),

  // Процессор
  str("cpuModel", "cpu_model", "Модель процессора"),
  sel("socket", "cpu_socket", "Сокет", SOCKETS),
  num("cpuCores", "cpu_cores", "Общее количество ядер", "шт"),
  num("cpuPCores", "cpu_p_cores", "Производительных ядер", "шт"),
  num("cpuECores", "cpu_e_cores", "Энергоэффективных ядер", "шт"),
  num("cpuThreads", "cpu_threads", "Количество потоков", "шт"),
  num("cpuBaseClock", "cpu_base_clock", "Базовая частота", "ГГц"),
  num("cpuMaxClock", "cpu_max_clock", "Максимальная частота", "ГГц"),
  num("cpuL3", "cpu_l3_cache", "Кэш L3", "МБ"),
  num("cpuTdp", "cpu_tdp", "Тепловыделение (TDP)", "Вт"),
  str("cpuGraphics", "cpu_graphics", "Встроенное графическое ядро"),
  msel("memorySupport", "memory_support", "Поддерживаемая память", ["DDR4", "DDR5"]),

  // Материнская плата
  sel("boardFormFactor", "board_form_factor", "Форм-фактор платы", [
    "E-ATX",
    "ATX",
    "Micro-ATX",
    "Mini-ITX",
  ]),
  str("chipset", "chipset", "Чипсет"),
  num("memorySlots", "ram_slots", "Слотов памяти", "шт"),
  num("memoryMax", "ram_max_value", "Максимальный объём памяти", "ГБ"),
  num("m2Slots", "board_m2_slots", "Слотов M.2", "шт"),
  num("sataPorts", "board_sata_ports", "Портов SATA", "шт"),
  num("pcieX16Slots", "board_pcie_x16_slots", "Слотов PCI-E x16", "шт"),
  sel(
    "nicSpeed",
    "nic_speed",
    "Скорость сетевого адаптера",
    ["1", "2.5", "5", "10"].map((value) => ({ value, label: `${value} Гбит/с` })),
    "Гбит/с",
  ),
  sel("wifiStandard", "wifi_standard", "Стандарт Wi-Fi", [
    "нет", "Wi-Fi 4", "Wi-Fi 5", "Wi-Fi 6", "Wi-Fi 6E", "Wi-Fi 7",
  ]),
  str("bluetooth", "bluetooth_version", "Версия Bluetooth"),
  str("videoOutputs", "video_outputs", "Видеовыходы"),
  str("rearUsb", "board_rear_usb", "USB на задней панели"),

  // Оперативная память
  sel("memoryType", "memory_type", "Тип памяти", ["DDR3", "DDR3L", "DDR4", "DDR5"]),
  sel("memoryFormFactor", "ramformfactor", "Форм-фактор памяти", ["DIMM", "SO-DIMM"]),
  num("moduleSize", "ram_module_size", "Объём модуля", "ГБ"),
  num("memoryClock", "ram_frequency", "Частота памяти", "МГц"),
  num("casLatency", "ram_cas_latency", "CAS-латентность"),
  num("memoryGb", "ram_value", "Объём оперативной памяти", "ГБ"),
  bool("memorySoldered", "ram_soldered", "Память распаяна"),
  num("memoryMb", "ram_mb", "Объём ОЗУ", "МБ"),

  // Накопители
  sel("driveType", "drive_type", "Тип накопителя", ["SSD", "HDD"]),
  num("driveCapacity", "drive_capacity", "Объём накопителя", "ГБ"),
  sel("driveFormFactor", "drive_form_factor", "Форм-фактор накопителя", [
    "M.2 2280", "M.2 2242", '2.5"', '3.5"',
  ]),
  sel("driveInterface", "drive_interface", "Интерфейс накопителя", [
    "SATA III", "PCIe 3.0 x4", "PCIe 4.0 x4", "PCIe 5.0 x4",
  ]),
  num("driveRead", "drive_read_speed", "Скорость чтения", "МБ/с"),
  num("driveWrite", "drive_write_speed", "Скорость записи", "МБ/с"),
  num("driveTbw", "drive_tbw", "Ресурс записи (TBW)", "ТБ"),

  // Видеокарта
  str("gpuChip", "gpu_chip", "Графический процессор"),
  str("gpuModel", "gpu_model", "Модель видеокарты"),
  num("gpuMemory", "gpu_memory", "Объём видеопамяти", "ГБ"),
  sel("gpuMemoryType", "gpu_memory_type", "Тип видеопамяти", ["GDDR5", "GDDR6", "GDDR6X", "GDDR7"]),
  num("gpuPsu", "gpu_recommended_psu", "Рекомендуемый блок питания", "Вт"),

  // Блок питания и питание устройств
  num("psuPower", "psu_power", "Мощность", "Вт"),
  sel("psuCertificate", "psu_80plus", "Сертификат 80 PLUS", [
    "нет", "White", "Bronze", "Silver", "Gold", "Platinum", "Titanium",
  ]),
  sel("psuFormFactor", "psu_form_factor", "Форм-фактор БП", ["ATX", "SFX", "TFX"]),
  bool("psuModular", "psu_modular", "Модульное подключение"),
  num("batteryCapacity", "battery_capacity_wh", "Ёмкость аккумулятора", "Вт·ч"),
  num("chargerPower", "charger_power", "Мощность адаптера", "Вт"),
  num("powerDraw", "power_consumption", "Потребляемая мощность", "Вт"),
  bool("poeIn", "poe_in", "Питание PoE-in"),
  bool("redundantPsu", "redundant_psu", "Резервный блок питания"),

  // Разъёмы и корпус
  str("usbA", "usb_type_a", "Порты USB Type-A"),
  str("usbC", "usb_type_c", "Порты USB Type-C"),
  str("audioJacks", "audio_jacks", "Аудиоразъёмы"),
  bool("cardReader", "card_reader", "Кард-ридер"),
  bool("rj45", "rj45_port", "Сетевой порт RJ-45"),
  bool("sideWindow", "case_side_window", "Окно на боковой стенке"),
  bool("opticalDrive", "optical_drive", "Оптический привод"),

  // Охлаждение
  sel("coolingType", "cooling_type", "Тип охлаждения", ["воздушное", "жидкостное"]),
  num("coolingPower", "cooling_dissipation", "Рассеиваемая мощность", "Вт"),
  msel("coolingSockets", "cooling_sockets", "Совместимые сокеты", SOCKETS),

  // Беспроводная сеть
  sel("adapterInterface", "adapter_interface", "Интерфейс подключения", ["PCIe", "USB"]),
  msel("wifiBands", "wifi_bands", "Диапазоны", ["2.4 ГГц", "5 ГГц", "6 ГГц"]),

  // Экран
  num("screenDiagonal", "screen_diagonal", "Диагональ экрана", '"'),
  sel("screenResolution", "screen_resolution", "Разрешение экрана", [
    "1366×768", "1920×1080", "1920×1200", "2560×1440", "2560×1600", "2880×1800", "3840×2160",
  ]),
  sel("screenPanel", "screen_panel", "Тип матрицы", ["IPS", "OLED", "TN", "VA"]),
  num("screenRefresh", "screen_refresh_rate", "Частота обновления", "Гц"),
  bool("touchscreen", "touchscreen", "Сенсорный экран"),
  bool("webcam", "webcam", "Веб-камера"),

  // Сетевое оборудование
  num("lanPorts", "lan_ports", "Портов LAN", "шт"),
  num("wanPorts", "wan_ports", "Портов WAN", "шт"),
  sel("portSpeed", "portspeed", "Скорость портов", [
    { value: "0.1", label: "100 Мбит/с" },
    { value: "1", label: "1 Гбит/с" },
    { value: "2.5", label: "2.5 Гбит/с" },
    { value: "10", label: "10 Гбит/с" },
    { value: "25", label: "25 Гбит/с" },
    { value: "40", label: "40 Гбит/с" },
    { value: "100", label: "100 Гбит/с" },
  ]),
  num("sfpPorts", "sfp_ports", "Портов SFP", "шт"),
  num("sfpPlusPorts", "sfp_plus_ports", "Портов SFP+", "шт"),
  bool("usbPort", "usb_port", "Порт USB"),
  msel("vpn", "vpn_protocols", "VPN", ["WireGuard", "IPsec", "OpenVPN", "L2TP", "PPTP", "SSTP"]),
  sel("switchManagement", "switch_management", "Управление", [
    "неуправляемый", "web-smart", "управляемый L2", "управляемый L3",
  ]),
  num("rackUnits", "rack_units", "Высота в юнитах", "U"),
  num("ports1g", "ports_1g_rj45", "Портов 1G RJ-45", "шт"),
  num("ports2g5", "ports_2_5g_rj45", "Портов 2.5G RJ-45", "шт"),
  num("ports10g", "ports_10g_rj45", "Портов 10G RJ-45", "шт"),
  bool("consolePort", "console_port", "Консольный порт"),
  num("poePorts", "poe_ports", "Портов PoE", "шт"),
  msel("poeStandard", "poe_standard", "Стандарт PoE", ["802.3af", "802.3at", "802.3bt"]),
  num("poeBudget", "poe_budget", "Бюджет PoE", "Вт"),
  num("switchingCapacity", "switching_capacity", "Пропускная способность", "Гбит/с"),
  num("macTable", "mac_table_size", "Размер таблицы MAC"),
  bool("vlan", "vlan_support", "Поддержка VLAN"),

  // МФУ
  sel("printTechnology", "print_technology", "Технология печати", [
    "лазерная",
    "светодиодная",
    "струйная",
  ]),
  sel("printColor", "print_color", "Цветность печати", ["чёрно-белая", "цветная"]),
  sel("paperSize", "max_paper_size", "Максимальный формат", ["A4", "A3"]),
  num("printSpeed", "print_speed", "Скорость печати", "стр/мин"),
  str("printResolution", "print_resolution", "Разрешение печати", "dpi"),
  bool("duplexPrint", "duplex_print", "Двусторонняя печать"),
  num("dutyCycle", "recommended_volume", "Рекомендуемая нагрузка", "стр/мес"),
  sel("scannerType", "scanner_type", "Тип сканера", [
    "планшетный",
    "протяжный",
    "планшетный + протяжный",
  ]),
  str("scanResolution", "scan_resolution", "Разрешение сканирования", "dpi"),
  bool("adf", "adf", "Автоподатчик (ADF)"),
  bool("duplexScan", "duplex_scan", "Двустороннее сканирование"),
  num("copySpeed", "copy_speed", "Скорость копирования", "стр/мин"),
  bool("networkInterface", "network_interface", "Сетевой интерфейс"),
  bool("wifi", "wifi", "Wi-Fi"),
  str("cartridgeModel", "cartridge_model", "Модель картриджа"),
  num("cartridgeYield", "cartridge_yield", "Ресурс картриджа", "стр"),

  // Габариты
  num("length", "length", "Длина", "мм"),
  num("width", "width", "Ширина", "мм"),
  num("height", "height", "Высота", "мм"),
  num("depth", "depth", "Глубина", "мм"),
  num("thickness", "thickness", "Толщина", "мм"),
  num("weight", "weight", "Вес", "кг"),
];

/** Связки типа по группам: { группа: [ключи атрибутов] } в порядке показа. */
const linksOf = (byGroup) =>
  Object.entries(byGroup).flatMap(([group, attrs]) => attrs.map((attr) => ({ attr, group })));

const component = (key, name, byGroup) => ({
  key, name, flags: { isComponent: true }, attributes: linksOf(byGroup),
});

// Общие куски заводских типов: ноутбук, моноблок и брендовый системный блок
const PC_CPU = ["cpuModel", "cpuCores", "cpuThreads", "cpuMaxClock"];
const PC_MEMORY = ["memoryGb", "memoryType", "memorySoldered", "memorySlots"];
const PC_STORAGE = ["driveCapacity", "driveInterface"];
const PC_GPU = ["gpuModel", "gpuMemory"];
const PC_WIRELESS = ["wifiStandard", "bluetooth"];
const PC_CONNECTORS = ["usbA", "usbC", "videoOutputs", "rj45", "cardReader"];
const SCREEN = [
  "screenDiagonal",
  "screenResolution",
  "screenPanel",
  "screenRefresh",
  "touchscreen",
];

const types = [
  // Комплектующие
  component("cpu", "Процессор", {
    general: ["line", "releaseYear"],
    cpu: [
      "socket", "cpuCores", "cpuPCores", "cpuECores", "cpuThreads", "cpuBaseClock",
      "cpuMaxClock", "cpuL3", "cpuTdp", "cpuGraphics", "memorySupport",
    ],
  }),
  component("motherboard", "Материнская плата", {
    motherboard: [
      "boardFormFactor", "socket", "chipset", "memorySlots", "memorySupport", "memoryMax",
      "m2Slots", "sataPorts", "pcieX16Slots",
    ],
    network: ["nicSpeed"],
    wireless: ["wifiStandard", "bluetooth"],
    connectors: ["videoOutputs", "rearUsb"],
  }),
  component("memory", "Оперативная память", {
    memory: ["memoryType", "memoryFormFactor", "moduleSize", "memoryClock", "casLatency"],
  }),
  component("drive", "Накопитель", {
    storage: [
      "driveType", "driveCapacity", "driveFormFactor", "driveInterface", "driveRead",
      "driveWrite", "driveTbw",
    ],
  }),
  component("gpu", "Видеокарта", {
    gpu: ["gpuChip", "gpuMemory", "gpuMemoryType", "videoOutputs", "gpuPsu"],
  }),
  component("psu", "Блок питания", {
    power: ["psuPower", "psuCertificate", "psuFormFactor", "psuModular"],
  }),
  component("case", "Корпус", {
    general: ["caseFormFactor", "color"],
    front: ["usbA", "usbC", "audioJacks", "cardReader"],
    extra: ["sideWindow", "opticalDrive"],
    dimensions: ["length", "width", "height", "weight"],
  }),
  component("cooler", "Охлаждение", {
    cooling: ["coolingType", "coolingPower", "coolingSockets"],
  }),
  component("wifiAdapter", "Wi-Fi адаптер", {
    wireless: ["wifiStandard", "bluetooth", "adapterInterface"],
  }),

  // Собираемый: атрибуты для брендовых моделей — как у моноблока без экрана
  {
    key: "systemUnit",
    name: "Системный блок",
    attributes: linksOf({
      general: ["line", "releaseYear", "color", "caseFormFactor"],
      software: ["preinstalledOs"],
      cpu: PC_CPU,
      memory: PC_MEMORY,
      storage: PC_STORAGE,
      gpu: PC_GPU,
      wireless: PC_WIRELESS,
      connectors: PC_CONNECTORS,
      power: ["psuPower"],
      dimensions: ["width", "height", "depth", "weight"],
    }),
  },

  // Заводские
  {
    key: "laptop",
    name: "Ноутбук",
    attributes: linksOf({
      general: ["line", "releaseYear", "color"],
      software: ["preinstalledOs"],
      screen: SCREEN,
      cpu: PC_CPU,
      memory: PC_MEMORY,
      storage: PC_STORAGE,
      gpu: PC_GPU,
      wireless: PC_WIRELESS,
      connectors: PC_CONNECTORS,
      power: ["batteryCapacity", "chargerPower"],
      dimensions: ["weight", "thickness"],
    }),
  },
  {
    key: "allInOne",
    name: "Моноблок",
    attributes: linksOf({
      general: ["line", "releaseYear", "color"],
      software: ["preinstalledOs"],
      screen: SCREEN,
      cpu: PC_CPU,
      memory: PC_MEMORY,
      storage: PC_STORAGE,
      gpu: PC_GPU,
      wireless: PC_WIRELESS,
      connectors: PC_CONNECTORS,
      power: ["chargerPower"],
      extra: ["webcam"],
      dimensions: ["width", "height", "weight"],
    }),
  },
  {
    key: "router",
    name: "Маршрутизатор",
    attributes: linksOf({
      general: ["line", "mounting"],
      software: ["os", "licenseLevel"],
      cpu: ["cpuModel", "cpuCores"],
      memory: ["memoryMb"],
      ports: ["lanPorts", "wanPorts", "portSpeed", "sfpPorts", "sfpPlusPorts", "usbPort"],
      wireless: ["wifiStandard", "wifiBands"],
      extra: ["vpn", "poeIn"],
      power: ["powerDraw"],
      dimensions: ["width", "height", "depth"],
    }),
  },
  {
    key: "switch",
    name: "Коммутатор",
    attributes: linksOf({
      general: ["switchManagement", "mounting", "rackUnits"],
      ports: ["ports1g", "ports2g5", "ports10g", "sfpPorts", "sfpPlusPorts", "consolePort"],
      poe: ["poePorts", "poeStandard", "poeBudget"],
      switching: ["switchingCapacity", "macTable", "vlan"],
      power: ["powerDraw", "redundantPsu"],
      dimensions: ["width", "height", "depth"],
    }),
  },
  {
    key: "mfp",
    name: "МФУ",
    attributes: linksOf({
      general: ["printTechnology", "printColor", "paperSize"],
      print: ["printSpeed", "printResolution", "duplexPrint", "dutyCycle"],
      scan: ["scannerType", "scanResolution", "adf", "duplexScan"],
      copy: ["copySpeed"],
      connectors: ["networkInterface", "wifi", "usbPort"],
      consumables: ["cartridgeModel", "cartridgeYield"],
    }),
  },
];

const catalog = { groups, types, attributes };

module.exports = {
  catalog,
  apply: ({ log }) => applyCatalog(catalog, { log }),
};
