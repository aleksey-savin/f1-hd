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
      packages.map((pkg, i) => (i === index ? { ...pkg, [field]: value } : pkg)),
    );
  const remove = (index) => onChange(packages.filter((_, i) => i !== index));
  const add = () => onChange([...packages, { hours: 0, pricePerHour: 0 }]);

  return (
    <div>
      <div className="tw:mb-2 tw:flex tw:items-center tw:justify-between">
        <span className="tw:text-sm tw:font-semibold tw:text-muted-foreground">
          Пакеты часов
        </span>
        <Button type="button" variant="outline" size="sm" onClick={add}>
          <RiAddLine /> Добавить пакет
        </Button>
      </div>
      <div className="tw:grid tw:gap-2">
        {packages.map((pkg, index) => {
          const total = (Number(pkg.hours) || 0) * (Number(pkg.pricePerHour) || 0);
          return (
            <div
              key={index}
              className="tw:flex tw:flex-wrap tw:items-end tw:gap-x-4 tw:gap-y-3 tw:rounded-xl tw:border tw:border-border-soft tw:bg-accent/40 tw:p-3"
            >
              <label className="tw:grid tw:gap-1">
                <span className="tw:text-xs tw:font-bold tw:tracking-wider tw:text-faint tw:uppercase">
                  Часов
                </span>
                <Input
                  type="number"
                  min={1}
                  value={pkg.hours}
                  onChange={(event) => update(index, "hours", event.target.value)}
                  className="tw:h-9 tw:w-24 tw:tabular-nums"
                />
              </label>
              <label className="tw:grid tw:gap-1">
                <span className="tw:text-xs tw:font-bold tw:tracking-wider tw:text-faint tw:uppercase">
                  Ставка, ₽/ч
                </span>
                <Input
                  type="number"
                  min={1}
                  value={pkg.pricePerHour}
                  onChange={(event) =>
                    update(index, "pricePerHour", event.target.value)
                  }
                  className="tw:h-9 tw:w-28 tw:tabular-nums"
                />
              </label>
              <div className="tw:ml-auto tw:text-right">
                <div className="tw:text-xs tw:font-bold tw:tracking-wider tw:text-faint tw:uppercase">
                  Итого
                </div>
                <div className="tw:text-lg tw:font-bold tw:text-accent-text tw:tabular-nums">
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
                className="tw:text-faint"
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
