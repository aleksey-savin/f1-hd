import { RiLoader4Line } from "react-icons/ri";

import { cn } from "@/lib/utils";

// tw-двойник animations/Spinner.jsx (react-spinners CircleLoader): спокойный
// спиннер в акцентном цвете, центрированный в высокой области списка.
const Spinner = ({
  className,
  size = 48,
}: {
  className?: string;
  size?: number;
}) => {
  return (
    <div
      role="status"
      aria-label="Загрузка"
      className={cn(
        "tw:flex tw:min-h-[50vh] tw:items-center tw:justify-center",
        className,
      )}
    >
      <RiLoader4Line
        size={size}
        aria-hidden
        className="tw:animate-spin tw:text-primary"
      />
    </div>
  );
};

export default Spinner;
