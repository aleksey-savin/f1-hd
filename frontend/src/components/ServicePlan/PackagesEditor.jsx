import { RiAddLine, RiDeleteBinLine } from "react-icons/ri";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { formatPrice } from "../../util/format-string";

const money = (value) => formatPrice(Math.round(Number(value) || 0));

// Редактор пакетов часов: карточка на пакет (часы · ставка · авто-«итого»),
// добавление/удаление. «Итого» = часы × ставка, только для чтения (согласовано).
const PackagesEditor = ({ packages, onChange }) => {
  const update = (index, field, value) =>
    onChange(
      packages.map((pkg, i) =>
        i === index ? { ...pkg, [field]: value } : pkg,
      ),
    );
  const remove = (index) => onChange(packages.filter((_, i) => i !== index));
  const add = () => onChange([...packages, { hours: 0, pricePerHour: 0 }]);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-muted-foreground">
          Пакеты часов
        </span>
        <Button type="button" variant="outline" size="sm" onClick={add}>
          <RiAddLine /> Новый пакет
        </Button>
      </div>
      <div className="grid gap-2">
        {packages.map((pkg, index) => {
          const total =
            (Number(pkg.hours) || 0) * (Number(pkg.pricePerHour) || 0);
          return (
            <div
              key={index}
              className="flex flex-wrap items-end gap-x-4 gap-y-3 rounded-xl border border-border-soft bg-accent/40 p-3"
            >
              <label className="grid gap-1">
                <span className="text-xs font-bold tracking-wider text-faint uppercase">
                  Часов
                </span>
                <Input
                  type="number"
                  min={1}
                  value={pkg.hours}
                  onChange={(event) =>
                    update(index, "hours", event.target.value)
                  }
                  className="h-9 w-24 tabular-nums"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-xs font-bold tracking-wider text-faint uppercase">
                  Ставка, ₽/ч
                </span>
                <Input
                  type="number"
                  min={1}
                  value={pkg.pricePerHour}
                  onChange={(event) =>
                    update(index, "pricePerHour", event.target.value)
                  }
                  className="h-9 w-28 tabular-nums"
                />
              </label>
              <div className="ml-auto text-right">
                <div className="text-xs font-bold tracking-wider text-faint uppercase">
                  Итого
                </div>
                <div className="text-lg font-bold text-accent-text tabular-nums">
                  {money(total)}
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => remove(index)}
                aria-label="Удалить пакет"
                title="Удалить пакет"
                className="text-faint"
              >
                <RiDeleteBinLine />
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PackagesEditor;
