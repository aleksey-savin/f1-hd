/**
 * Монтирование группы `/inventory` — вынесено из `routes/index.js` не ради
 * красоты.
 *
 * У express `use(path, gateA, gateB, subRouter)` регистрирует КАЖДЫЙ аргумент
 * отдельным слоем на одном и том же префиксе. Пока все под-роутеры висели на
 * `/inventory`, гейты соседних монтирований отрабатывали на чужих запросах — по
 * порядку регистрации, а не по тому, кто запрос обслужит. Следствия были
 * ровно обратны замыслу: справочники требовали «видеть технику», расположения
 * пропускались через пять слоёв «не клиент», поставщики — через «видеть
 * Mikrotik», а сам Mikrotik, «самостоятельная интеграция», требовал включённого
 * модуля учёта техники.
 *
 * Поэтому гейты стоят слоями на СВОИХ префиксах (у каждого под-роутера он свой
 * и уникальный), а роутеры монтируются голыми: чей префикс запрос задел, того
 * права и спрашиваются.
 *
 * Гейты и роутеры приходят аргументами, а карта «префикс → право» живёт здесь:
 * так её проверяет тест (`routes/inventoryMount.test.js`) на заглушках, не
 * поднимая модели и алиасы.
 */

/**
 * Пути, которые под-роутер реально обслуживает — для проверки покрытия гейтами.
 *
 * Префикс вложенного `use(prefix, router)` в express 5 из слоя не достать
 * (`layer.path` пуст, остаётся только матчер), поэтому вложенные роутеры
 * разворачиваются как есть: их пути будут проверены без родительского префикса
 * и почти наверняка проверку не пройдут. Это намеренно — вложенность в группе
 * `/inventory` не используется, а появится она вместе с решением, под каким
 * правом жить.
 */
const routePaths = (router) => {
  const paths = [];
  for (const layer of router?.stack || []) {
    const routePath = layer.route?.path;
    if (routePath !== undefined) {
      paths.push(...(Array.isArray(routePath) ? routePath : [routePath]));
      continue;
    }
    if (Array.isArray(layer.handle?.stack)) {
      paths.push(...routePaths(layer.handle));
    }
  }
  return paths;
};

/**
 * @param {import("express").Router} router группа внутренних маршрутов
 * @param {object} gates гейты из `middleware/permissions`
 * @param {Array} routers под-роутеры `/inventory` в любом порядке
 */
const mountInventory = (router, gates, routers) => {
  const {
    inventoryModuleIsActive,
    mikrotikIsActive,
    canReadDevices,
    isNotClient,
    canReadSuppliers,
    canReadMikrotik,
  } = gates;

  const layers = [
    // Реестр техники и расположения — по праву «видеть технику».
    [["/client-devices"], [inventoryModuleIsActive, canReadDevices]],
    [
      ["/locations", "/companies-locations"],
      [inventoryModuleIsActive, canReadDevices],
    ],
    // Справочники техники — выпадашки форм устройства: список открыт любому
    // сотруднику, раздел закрыт правом на маршруте фронта.
    [
      [
        "/device-types",
        "/device-models",
        "/device-attributes",
        "/device-type-attributes",
        "/device-configurations",
        "/vendors",
      ],
      [inventoryModuleIsActive, isNotClient],
    ],
    // Поставщики — своё право: у них цены и договоры, а не техника.
    [["/suppliers"], [inventoryModuleIsActive, canReadSuppliers]],
    // Mikrotik — самостоятельная интеграция (не зависит от модуля «Учёт
    // техники»): рубильник собственный, право на вход в раздел — тоже. Более
    // узкие права (устройства, конфигурации) проверяют сами роуты. Путь
    // /inventory сохранён — его знает фронтенд.
    [["/mikrotik-devices"], [mikrotikIsActive, canReadMikrotik]],
  ];

  // Гейты стоят на перечисленных префиксах — значит маршрут, который ни под
  // один из них не попал, идёт БЕЗ прав вовсе. Прежнее монтирование было
  // перекрыто лишним, но не могло оказаться открытым; здесь это возможно,
  // поэтому проверяется на старте: `/inventory/locations-secret` или будущий
  // `/inventory/reports/...` уронят приложение при запуске, а не молча откроют
  // данные. Лечится добавлением префикса в карту выше.
  const gated = layers.flatMap(([prefixes]) => prefixes);
  for (const subRouter of routers) {
    for (const path of routePaths(subRouter)) {
      const covered =
        typeof path === "string" &&
        gated.some(
          (prefix) => path === prefix || path.startsWith(`${prefix}/`),
        );
      if (!covered) {
        throw new Error(
          `routes/inventoryMount: маршрут "${path}" не попадает ни под один ` +
            "гейт /inventory — добавьте его префикс в карту прав",
        );
      }
    }
  }

  for (const [prefixes, middleware] of layers) {
    for (const prefix of prefixes) {
      router.use(`/inventory${prefix}`, ...middleware);
    }
  }

  for (const subRouter of routers) {
    router.use("/inventory", subRouter);
  }

  return router;
};

module.exports = { mountInventory };
