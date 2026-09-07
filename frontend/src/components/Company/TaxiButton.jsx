import { RiMapPin2Line, RiTaxiLine } from "react-icons/ri";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import useInitialPrefs from "@/store/prefs";
import { cn } from "@/lib/utils";

import { openTaxi } from "../../util/taxi-operators";
import { getTaxiChoices } from "./company-links";

// Кнопка «Такси» компании — одна на все поверхности: гнездо строки списка,
// строка адреса на карточке компании и на карточке заявки. Один адрес — клик
// сразу строит маршрут (openTaxi спрашивает текущее положение и открывает
// вкладку синхронно, до ответа геолокации). Адресов несколько (свой +
// подразделений со своим) и оператор умеет маршрут — тот же клик открывает
// меню адресов: адрес по умолчанию первым (на заявке — подразделение
// инициатора, `defaultKey` + `defaultReason`), остальные под своей меткой.
// Оператор не выбран (Preferences.taxi.operator) — кнопки нет.
//
// Вид кнопки задаёт поверхность через className (в строке — по наведению,
// на карточке — постоянно); по умолчанию — кнопка строки свойств карточки.

// Кнопка строки свойств карточки: как копирование в app/PropRow; цвет такси —
// под курсором и пока открыто меню
export const cardTaxiClass =
  "grid size-8 flex-none cursor-pointer appearance-none place-items-center rounded-lg border-0 bg-transparent text-faint transition-colors hover:bg-accent hover:text-warning data-[state=open]:bg-accent data-[state=open]:text-warning";

const labelClass = "text-xs font-semibold tracking-wider text-faint uppercase";

// Пункт меню в две строки: название места, под ним адрес целиком — выбирают
// по улице, а не по имени отдела; причина выбора по умолчанию и «без
// маршрута» (нет координат — заказ откроется без точки) — хвостом адреса
const AddressItem = ({ entry }) => (
  <DropdownMenuItem
    onSelect={() => openTaxi(entry.action)}
    className="items-start"
  >
    <RiMapPin2Line className="mt-0.5" />
    <span className="min-w-0">
      <span className="block font-medium">{entry.title}</span>
      <span className="block text-xs text-muted-foreground">
        {entry.address}
        {entry.reason && (
          <span className="text-accent-text"> · {entry.reason}</span>
        )}
        {!entry.action.supportsRoute && (
          <span className="text-faint"> · без маршрута</span>
        )}
      </span>
    </span>
  </DropdownMenuItem>
);

const TaxiButton = ({
  company,
  /** Ключ адреса по умолчанию (services/clientAddress → `key`). */
  defaultKey = null,
  /** Почему этот адрес первый — подпись пункта («подразделение инициатора»). */
  defaultReason = null,
  className = cardTaxiClass,
  iconSize = 16,
  /** Начало aria-label («Такси — Ромашка»); оператор допишется сам. */
  ariaLabel = "Такси",
}) => {
  const { taxi } = useInitialPrefs();
  const choices = getTaxiChoices(company, taxi?.operator, {
    defaultKey,
    defaultReason,
  });
  if (!choices) return null;

  const { action, menu, title } = choices;
  const label = `${ariaLabel} · ${action.label}`;

  if (!menu) {
    return (
      <button
        type="button"
        onClick={() => openTaxi(action)}
        title={title}
        aria-label={label}
        className={className}
      >
        <RiTaxiLine size={iconSize} />
      </button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={title}
          aria-label={`${label} — выбрать адрес`}
          className={cn(className, "data-[state=open]:opacity-100")}
        >
          <RiTaxiLine size={iconSize} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-72">
        <DropdownMenuLabel className={labelClass}>
          {menu.label}
        </DropdownMenuLabel>
        <AddressItem entry={menu.first} />
        <DropdownMenuSeparator />
        <DropdownMenuLabel className={labelClass}>
          {menu.restLabel}
        </DropdownMenuLabel>
        {menu.rest.map((entry) => (
          <AddressItem key={entry.key} entry={entry} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default TaxiButton;
