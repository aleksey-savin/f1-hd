/**
 * Видимость техники — одно правило на карточку устройства, её заявки, состав
 * сборки, подбор комплектующих и технику пользователя (спека W1, §3).
 *
 * Модуль чистый: условия собираются здесь, запросы делают контроллеры
 * (controllers/inventory/clientDevice.js, controllers/inventory/location.js).
 */

const mongoose = require("mongoose");

const HEX_OBJECT_ID = /^[a-f0-9]{24}$/i;

// Идентификатор из populate'нутого документа, вложенного объекта или сырого
// ObjectId — сравниваем строками.
const idOf = (value) => String(value?._id ?? value ?? "");

// Идентификатор для условия запроса — ObjectId. `find` приводит строку сам, а
// конвейер `aggregate` Mongoose не приводит: строка в `$match` не совпадёт с
// ObjectId в базе, и счётчик получится нулевым.
const toObjectId = (value) =>
  value instanceof mongoose.Types.ObjectId
    ? value
    : new mongoose.Types.ObjectId(idOf(value));

/**
 * Кто смотрит. `isEndUser` берётся из `req.auth`, где он уже приведён
 * (`user.isEndUser !== false`, services/authContext), а не из документа.
 */
const deviceViewer = (auth) => ({
  isEndUser: Boolean(auth?.isEndUser),
  companyId: auth?.user?.company?._id ?? null,
});

/**
 * Карточка устройства и всё, что к ней приложено: клиент видит технику только
 * своей компании, клиент без компании — ничего (как `scopeMatch` у списка).
 */
const deviceVisibleTo = (viewer, device) => {
  if (!viewer?.isEndUser) return true;
  const own = idOf(viewer.companyId);
  return Boolean(own) && idOf(device?.companyId) === own;
};

/**
 * Компания для подбора комплектующих (`getAttachable`). Клиенту — только своя:
 * чужая, кривая или повторённая в query (массив) даёт `null`, и ответ пустой.
 * Сотруднику — любая, но одна и настоящая.
 */
const attachableCompanyId = (viewer, requested) => {
  const id =
    typeof requested === "string" ? requested.trim().toLowerCase() : "";
  if (!HEX_OBJECT_ID.test(id)) return null;
  if (viewer?.isEndUser && id !== idOf(viewer.companyId).toLowerCase()) {
    return null;
  }
  return id;
};

/**
 * Заявки устройства в пределах видимости заявок автора запроса
 * (`ticketListFilter`, services/ticketScope): ярус «свои» у сотрудника через
 * устройство тоже не видит чужих заявок.
 */
const deviceTicketsFilter = (deviceId, ticketScope) => ({
  $and: [{ relatedClientDeviceId: deviceId }, ticketScope || {}],
});

/**
 * Скоуп в терминах ТЕХНИКИ: у устройства компания лежит в `companyId`.
 * `scope` — список id компаний из `companyScope` (controllers/inventory/
 * location.js), `null` — сотрудник, без ограничений.
 *
 * Нужен отдельно от расположения, потому что «расположение своей компании» ещё
 * не значит «вся техника в нём своя»: публичное расположение (`isPublic`) может
 * держать устройства чужой компании, и клиенту в списке видны были бы их модель
 * и инвентарный номер.
 *
 * Идентификаторы в условии — ObjectId, а не строки из `companyScope`: условие
 * попадает и в `aggregate` (счётчики техники во вложенных расположениях), а тот
 * типы не приводит, и клиент видел бы там нули. Строки остаются у
 * `companyScope`: им сверяют принадлежность (`includes(idOf(...))`).
 */
const deviceScopeMatch = (scope) =>
  scope ? { companyId: { $in: scope.map(toObjectId) } } : {};

/**
 * Скоуп компаний (для `deviceScopeMatch`) из того, кто смотрит: сотрудник —
 * `null` (без ограничений), клиент — своя компания, клиент без компании —
 * пустой список, то есть ничего.
 */
const viewerScope = (viewer) => {
  if (!viewer?.isEndUser) return null;
  const own = idOf(viewer.companyId);
  return own ? [own] : [];
};

/**
 * Комплектующие сборок, видимые автору запроса. Состав бывает смешанным: хозяина
 * переводят в другую компанию, а детали остаются прежними (`update` меняет
 * `companyId` хозяина и не трогает детали). Клиенту деталь чужой компании не
 * видна — ни в карточке сборки, ни в счётчике на строке списка.
 * `parentDeviceId` — id хозяина или условие `{ $in: [...] }`.
 */
const deviceComponentsFilter = (viewer, parentDeviceId) => ({
  deletedAt: null,
  parentDeviceId,
  ...deviceScopeMatch(viewerScope(viewer)),
});

/**
 * Хозяин сборки в ответе про комплектующее: клиенту — только из его компании,
 * чужой не показывается вовсе (`null`): ни название, ни инвентарный номер.
 * Компания хозяина должна быть выбрана в populate: без неё принадлежность
 * недоказуема, и клиенту хозяин не виден. У устройства без хозяина значение
 * остаётся как есть.
 */
const visibleHost = (viewer, host) =>
  !host || deviceVisibleTo(viewer, host) ? host : null;

/**
 * Техника пользователя (`getUserTech`): личная и рабочего места, и — уровнем
 * выше — техника родителя РМ. Обе выборки заперты скоупом компании.
 */
const userTechQueries = ({
  userId,
  workplaceId = null,
  parentId = null,
  scope = null,
}) => {
  const base = {
    deletedAt: null,
    parentDeviceId: null,
    ...deviceScopeMatch(scope),
  };
  return {
    own: {
      ...base,
      $or: [{ userId }, ...(workplaceId ? [{ locationId: workplaceId }] : [])],
    },
    parent: parentId ? { ...base, locationId: parentId } : null,
  };
};

module.exports = {
  attachableCompanyId,
  deviceComponentsFilter,
  deviceScopeMatch,
  deviceTicketsFilter,
  deviceViewer,
  deviceVisibleTo,
  userTechQueries,
  viewerScope,
  visibleHost,
};
