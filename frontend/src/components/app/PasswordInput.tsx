import * as React from "react";
import { RiEyeLine, RiEyeOffLine } from "react-icons/ri";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Поле пароля с кнопкой показа. До этого компонента каждая форма собирала его
// сама из bootstrap-InputGroup с инлайновыми радиусами и height: 58px — копий
// набралось четыре, и все разошлись.
//
// Иконка сообщает СОСТОЯНИЕ, а не действие: пароль скрыт — перечёркнутый глаз.
// Так было в легаси-формах, и менять смысл значка на переезде незачем.

/**
 * Класс для дополнительной кнопки в поле (`extra`). Экспортируется, чтобы
 * вторая кнопка не разошлась с глазом по размеру и цвету — ровно та беда, от
 * которой этот компонент и завёлся.
 */
export const adornmentButtonClass =
  "inline-flex size-8 cursor-pointer appearance-none items-center justify-center rounded-md border-0 bg-transparent p-0 text-faint transition-colors outline-none hover:text-foreground focus-visible:ring-4 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-faint";

const PasswordInput = ({
  className,
  shown: shownProp,
  onShownChange,
  extra,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "type"> & {
  /**
   * Управляемый показ. Нужен там, где раскрыть пароль решает не человек, а
   * форма: сгенерированный пароль надо прочитать и передать, поэтому он
   * показывается сразу.
   */
  shown?: boolean;
  onShownChange?: (shown: boolean) => void;
  /** Дополнительная кнопка слева от глаза — например, «скопировать». */
  extra?: React.ReactNode;
}) => {
  const [inner, setInner] = React.useState(false);
  const shown = shownProp ?? inner;

  const toggle = () => {
    setInner(!shown);
    onShownChange?.(!shown);
  };

  return (
    <div className="relative">
      <Input
        {...props}
        type={shown ? "text" : "password"}
        className={cn(extra ? "pe-18" : "pe-10", className)}
      />
      <div className="absolute end-1 top-1 flex items-center gap-0.5">
        {extra}
        <button
          type="button"
          aria-pressed={shown}
          aria-label={shown ? "Скрыть пароль" : "Показать пароль"}
          onClick={toggle}
          // appearance/border/bg/p-0 — preflight выключен, дефолты кнопки
          // никто не сбрасывает
          className={adornmentButtonClass}
        >
          {shown ? <RiEyeLine size={17} /> : <RiEyeOffLine size={17} />}
        </button>
      </div>
    </div>
  );
};

export default PasswordInput;
