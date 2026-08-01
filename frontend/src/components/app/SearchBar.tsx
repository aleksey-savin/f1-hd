import type { ChangeEventHandler } from "react";

import { RiSearchLine } from "react-icons/ri";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Поиск с иконкой — один на приложение. Передайте `value`, и поле станет
// управляемым: будет очищаться вместе с фильтром. С одним `defaultValue` сброс
// фильтра оставляет запрос в поле.
const SearchBar = ({
  onChange,
  size,
  defaultValue,
  value,
  autoFocus,
  className,
  placeholder = "Поиск…",
}: {
  onChange?: ChangeEventHandler<HTMLInputElement>;
  size?: "lg" | "md";
  defaultValue?: string;
  value?: string;
  autoFocus?: boolean;
  className?: string;
  placeholder?: string;
}) => {
  const controlled = value !== undefined;

  return (
    <form
      onSubmit={(event) => event.preventDefault()}
      className={cn("relative", className)}
    >
      <RiSearchLine
        size={16}
        aria-hidden
        className="absolute top-1/2 left-3 -translate-y-1/2 text-faint"
      />
      <Input
        id="search-bar"
        type="search"
        placeholder={placeholder}
        className={cn(
          // Поиск живёт в шапке на канве — фон панели, иначе сливается
          "bg-card pl-9 text-sm",
          size === "lg" ? "h-11" : "h-10",
        )}
        {...(controlled ? { value } : { defaultValue: defaultValue || "" })}
        onChange={onChange}
        autoFocus={autoFocus}
      />
    </form>
  );
};

export default SearchBar;
