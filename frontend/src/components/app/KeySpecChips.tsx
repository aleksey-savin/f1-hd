import type { KeySpecEntry } from "./assembly-specs";

/**
 * Ключевые характеристики сборки чипами под заголовком hero: «Процессор AMD
 * Ryzen 5 8600G». Общие у карточки сборки и карточки ПК своей сборки
 * (`buildKeySpecs`); пусто — ничего не рисуется.
 */
const KeySpecChips = ({ entries }: { entries: KeySpecEntry[] }) =>
  entries.length > 0 ? (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {entries.map((entry) => (
        <span
          key={entry.typeId}
          className="rounded-lg border border-border bg-card px-2.5 py-1 text-sm font-medium tabular-nums"
        >
          <span className="mr-1.5 font-normal text-faint">{entry.label}</span>
          {entry.value}
        </span>
      ))}
    </div>
  ) : null;

export default KeySpecChips;
