import type { ChangeEventHandler } from "react";

import { RiSearchLine } from "react-icons/ri";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// tw-двойник UI/SearchBar.jsx. Передайте `value` — поле станет управляемым и
// будет очищаться вместе с фильтром; с одним `defaultValue` сброс фильтра
// оставляет запрос в поле.
const SearchBar = ({
  onChange,
  size,
  defaultValue,
  value,
  autoFocus,
  className,
}: {
  onChange?: ChangeEventHandler<HTMLInputElement>;
  size?: "lg" | "md";
  defaultValue?: string;
  value?: string;
  autoFocus?: boolean;
  className?: string;
}) => {
  const controlled = value !== undefined;

  return (
    <form
      onSubmit={(event) => event.preventDefault()}
      className={cn("tw:relative", className)}
    >
      <RiSearchLine
        size={16}
        aria-hidden
        className="tw:absolute tw:top-1/2 tw:left-3 tw:-translate-y-1/2 tw:text-faint"
      />
      <Input
        id="search-bar"
        type="search"
        placeholder="Поиск…"
        className={cn(
          // Поиск живёт в шапке на канве — фон панели, иначе сливается
          "tw:bg-card tw:pl-9 tw:text-sm",
          size === "lg" ? "tw:h-11" : "tw:h-10",
        )}
        {...(controlled ? { value } : { defaultValue: defaultValue || "" })}
        onChange={onChange}
        autoFocus={autoFocus}
      />
    </form>
  );
};

export default SearchBar;
