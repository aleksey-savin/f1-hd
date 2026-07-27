// Дельта «текущее к предыдущему»: направление по знаку процента; нет базы
// (нулевой/пустой прошлый период) — percentage: null, рисуется «—».
export type Delta = {
  direction: "up" | "down" | "flat";
  percentage: number | null;
};

export const deltaOf = (current: number, previous: number): Delta => {
  if (!previous || previous <= 0) return { direction: "flat", percentage: null };
  const percentage = Math.round(((current - previous) / previous) * 100);
  return {
    direction: percentage > 0 ? "up" : percentage < 0 ? "down" : "flat",
    percentage,
  };
};
