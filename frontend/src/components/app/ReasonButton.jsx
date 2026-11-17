import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";

// aria-disabled сохраняет hover/focus; причина также видна под формой на таче.
export default function ReasonButton({ reason, children, onClick, ...props }) {
  const button = (
    <Button
      {...props}
      aria-disabled={Boolean(reason)}
      className={reason ? "opacity-50" : undefined}
      onClick={(event) => {
        if (reason) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
    >
      {children}
    </Button>
  );
  return reason ? (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent>{reason}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ) : (
    button
  );
}
