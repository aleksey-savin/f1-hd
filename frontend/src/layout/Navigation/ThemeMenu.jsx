import { useContext } from "react";
import { isMobile } from "react-device-detect";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { THEME_OPTIONS } from "@/components/app/ThemeSegment";
import { ThemeContext } from "@/store/theme-context";

/** The same theme preference as account settings, exposed next to the bell. */
export default function ThemeMenu() {
  const { theme, setTheme } = useContext(ThemeContext);
  const selected =
    THEME_OPTIONS.find((option) => option.value === theme) ??
    THEME_OPTIONS.find((option) => option.value === "system");
  const Icon = selected.Icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size={isMobile ? "icon-lg" : "icon-xs"}
          aria-label={`Тема оформления: ${selected.label}`}
          title="Тема оформления"
          className="shrink-0 text-muted-foreground hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
        >
          <Icon size={16} aria-hidden className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={setTheme}
          aria-label="Тема оформления"
        >
          {THEME_OPTIONS.map(({ value, label, Icon: OptionIcon }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <OptionIcon size={16} aria-hidden />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
