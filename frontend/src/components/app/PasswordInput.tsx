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
    <div className="relative">
      <Input
        {...props}
        type={shown ? "text" : "password"}
        className={cn("pe-10", className)}
      />
      <button
        type="button"
        aria-pressed={shown}
        aria-label={shown ? "Скрыть пароль" : "Показать пароль"}
        onClick={() => setShown((value) => !value)}
        // appearance/border/bg/p-0 — preflight выключен, дефолты кнопки
        // никто не сбрасывает
        className="absolute end-1 top-1 inline-flex size-8 cursor-pointer appearance-none items-center justify-center rounded-md border-0 bg-transparent p-0 text-faint transition-colors outline-none hover:text-foreground focus-visible:ring-4 focus-visible:ring-ring/50"
      >
        {shown ? <RiEyeLine size={17} /> : <RiEyeOffLine size={17} />}
      </button>
    </div>
  );
};

export default PasswordInput;
