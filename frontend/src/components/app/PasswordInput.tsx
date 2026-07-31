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

const PasswordInput = ({
  className,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "type">) => {
  const [shown, setShown] = React.useState(false);

  return (
    <div className="tw:relative">
      <Input
        {...props}
        type={shown ? "text" : "password"}
        className={cn("tw:pe-10", className)}
      />
      <button
        type="button"
        aria-pressed={shown}
        aria-label={shown ? "Скрыть пароль" : "Показать пароль"}
        onClick={() => setShown((value) => !value)}
        // appearance/border/bg/p-0 — preflight выключен, дефолты кнопки
        // никто не сбрасывает
        className="tw:absolute tw:end-1 tw:top-1 tw:inline-flex tw:size-8 tw:cursor-pointer tw:appearance-none tw:items-center tw:justify-center tw:rounded-md tw:border-0 tw:bg-transparent tw:p-0 tw:text-faint tw:transition-colors tw:outline-none tw:hover:text-foreground tw:focus-visible:ring-4 tw:focus-visible:ring-ring/50"
      >
        {shown ? <RiEyeLine size={17} /> : <RiEyeOffLine size={17} />}
      </button>
    </div>
  );
};

export default PasswordInput;
