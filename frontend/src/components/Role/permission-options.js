import { PERMISSION_MODULES } from "@/components/User/permissions-catalog";

/**
 * Значения фасета «Права» — единственного условия каталога ролей.
 *
 * Условие обратное обычному: не «покажи роли такого-то вида», а «у КОГО есть
 * вот это право» — с ним приходят, когда надо понять, кто дотягивается до
 * финансов или до чужих заявок. Живёт фасет в СТРОКЕ ИНСТРУМЕНТОВ, а не в
 * Sheet-фильтре: единственное условие экрана прятать за кнопкой нельзя.
 *
 * Порядок и подписи — те же, что в форме роли: каталог прав один
 * (permissions-catalog.js), иначе один список читался бы двумя способами.
 * Мастер-право модуля («доступ к разделу») в списке есть — именно им чаще
 * всего и спрашивают: «у какой роли вообще есть финансы».
 */
const PERMISSION_OPTIONS = PERMISSION_MODULES.flatMap((module) => [
  ...(module.master
    ? [{ value: module.master, label: `${module.label} · доступ к разделу` }]
    : []),
  ...module.caps.map((cap) => ({
    value: cap.key,
    label: `${module.label} · ${cap.label.toLowerCase()}`,
  })),
]);

export { PERMISSION_OPTIONS };
