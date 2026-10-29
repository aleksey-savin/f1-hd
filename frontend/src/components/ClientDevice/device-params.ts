// Параметры устройства (атрибуты уровня «device» эффективного типа): что
// показать в форме. В мастере — только обязательные, остальные называются
// подсказкой «… — потом, в карточке устройства.»; в правке — все.

type ParamLink = {
  required?: boolean;
  attributeId?: { name?: string } | string | null;
};

export type ParamsMode = "wizard" | "edit";

const nameOf = (link: ParamLink): string =>
  (link.attributeId && typeof link.attributeId === "object" && link.attributeId.name) || "";

export const paramsForStep = <T extends ParamLink>(
  links: T[] | null | undefined,
  mode: ParamsMode,
): { shown: T[]; laterNames: string[] } => {
  const list = links ?? [];
  if (mode === "edit") return { shown: list, laterNames: [] };
  return {
    shown: list.filter((link) => link.required),
    laterNames: list.filter((link) => !link.required).map(nameOf).filter(Boolean),
  };
};

// «Дата производства» → «дата производства», «IP-адрес» остаётся (аббревиатура)
const inSentence = (name: string): string =>
  /^\p{Lu}\p{Lu}/u.test(name) ? name : name.charAt(0).toLocaleLowerCase("ru") + name.slice(1);

/** «IP-адрес, MAC-адрес и дата производства — потом, в карточке устройства.» */
export const laterHint = (names: string[]): string => {
  if (!names.length) return "";
  const words = names.map(inSentence);
  const list =
    words.length === 1 ? words[0] : `${words.slice(0, -1).join(", ")} и ${words[words.length - 1]}`;
  return `${list.charAt(0).toLocaleUpperCase("ru")}${list.slice(1)} — потом, в карточке устройства.`;
};
