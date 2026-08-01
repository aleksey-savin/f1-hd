import type { ReactNode } from "react";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

// Строка свитча в форме: свитч · подпись · подсказка-эффект. Radix-свитч не
// попадает в FormData сам — при переданном `name` значение уходит скрытым
// input'ом ("true"/"false"; router-экшены сравнивают === "true").
const SwitchField = ({
  id,
  name,
  checked,
  onCheckedChange,
  label,
  hint,
  divider = false,
  disabled = false,
  className,
}: {
  id: string;
  name?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  /** Тонкая линия сверху — между соседними свитчами. */
  divider?: boolean;
  disabled?: boolean;
  className?: string;
}) => {
  return (
    <div
      className={cn(
        "flex items-start gap-3 py-3",
        divider && "border-t border-border-soft",
        className,
      )}
    >
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className="mt-0.5"
      />
      <Label htmlFor={id} className="grid gap-0.5 text-base font-medium">
        {label}
        {hint && (
          <span className="text-sm font-normal text-muted-foreground">
            {hint}
          </span>
        )}
      </Label>
      {name && (
        <input type="hidden" name={name} value={checked ? "true" : "false"} />
      )}
    </div>
  );
};

export default SwitchField;
