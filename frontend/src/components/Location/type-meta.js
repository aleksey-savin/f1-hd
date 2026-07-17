import {
  RiArchiveLine,
  RiBuilding2Line,
  RiComputerLine,
  RiDoorLine,
  RiStackLine,
} from "react-icons/ri";

// Карта типов расположения — единый источник подписи и иконки для дерева
// списка и карточки (ср. DeviceType/kinds.js).
export const TYPE_LABEL = {
  building: "Здание",
  floor: "Этаж",
  room: "Помещение",
  workplace: "Рабочее место",
  storage: "Склад",
};

export const TYPE_ICON = {
  building: RiBuilding2Line,
  floor: RiStackLine,
  room: RiDoorLine,
  workplace: RiComputerLine,
  storage: RiArchiveLine,
};

// Типы, внутрь которых можно вложить дочернее расположение.
export const CHILD_CAPABLE = ["building", "floor", "room"];
