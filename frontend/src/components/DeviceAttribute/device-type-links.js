// Связи тип↔атрибут живут в отдельной коллекции (DeviceTypeAttribute), и в
// сторону атрибута их отдаёт getAll ТИПОВ — полем `attributes` (проекция
// связок). Поэтому список атрибутов строит привязки из каталога типов,
// который уже загружен для фасета «Тип устройства», и отдельного запроса за
// ними не делает. Один модуль на всех, кто читает эту связь: фасет страницы,
// колонка строки и диалог привязки.

/** id атрибутов, привязанных к типу. */
export const attributeIdsOfType = (deviceType) =>
  (deviceType.attributes || []).map((link) =>
    String(link.attributeId?._id ?? link.attributeId),
  );

/** Типы, в которых используется атрибут, — в порядке каталога (по алфавиту). */
export const typesOfAttribute = (deviceTypes, attributeId) =>
  (deviceTypes || []).filter((deviceType) =>
    attributeIdsOfType(deviceType).includes(String(attributeId)),
  );
