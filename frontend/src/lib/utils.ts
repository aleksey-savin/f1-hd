import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Пока идёт миграция с Bootstrap, все tailwind-утилиты носят префикс tw:
// (см. src/styles/tailwind.css) — twMerge обязан о нём знать, иначе классы
// перестанут схлопываться и «последний побеждает» сломается.
const twMerge = extendTailwindMerge({ prefix: "tw" });

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
