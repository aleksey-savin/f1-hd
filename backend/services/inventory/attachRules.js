// Правило «что можно прикрепить к сборке как комплектующее». Общее для
// контроллера (getAttachable) и MCP-инструментов инвентаря.

// Тип прикрепляемый: несёт один из флагов комплектующего/расходника/
// периферии и, если ограничен attachableToTypeIds, совместим с типом хоста.
const isAttachableType = (type, hostTypeId) => {
  if (!type) return false;
  if (!type.isComponent && !type.isConsumable && !type.isPeripheral) {
    return false;
  }
  const attachable = type.attachableToTypeIds || [];
  if (attachable.length && hostTypeId) {
    return attachable.some((a) => String(a) === String(hostTypeId));
  }
  return true;
};

// candidates — устройства; typeOf(device) → id типа или null;
// typeById — Map<string, type>; assemblyIds — Set строк: устройства, у которых
// уже есть комплектующие (вложенные сборки не предлагаем). Порядок сохраняется.
const filterAttachable = ({
  candidates,
  typeOf,
  typeById,
  assemblyIds,
  hostTypeId,
}) =>
  candidates.filter((d) => {
    if (assemblyIds.has(String(d._id))) return false;
    const typeId = typeOf(d);
    if (!typeId) return false;
    return isAttachableType(typeById.get(String(typeId)), hostTypeId);
  });

module.exports = { isAttachableType, filterAttachable };
