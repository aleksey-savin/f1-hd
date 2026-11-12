import { useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { RiArrowRightSLine, RiMoreLine } from "react-icons/ri";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { crumbStateFor } from "@/util/crumb-trail";
import { useCrumbContext } from "./crumb-context";

export default function HeaderCrumbs() {
  const context = useCrumbContext();
  const items = context?.items ?? [];
  const nav = useRef<HTMLElement>(null);
  const measure = useRef<HTMLOListElement>(null);
  const [mode, setMode] = useState<"full" | "middle" | "all">("full");
  useLayoutEffect(() => {
    const container = nav.current;
    const ruler = measure.current;
    if (!container || !ruler) return;
    const update = () => {
      const width = container.clientWidth;
      const first = ruler.firstElementChild?.getBoundingClientRect().width ?? 0;
      const last = ruler.lastElementChild?.getBoundingClientRect().width ?? 0;
      const unit = parseFloat(getComputedStyle(container).fontSize);
      setMode(
        ruler.scrollWidth <= width
          ? "full"
          : items.length > 2 &&
              first + Math.min(last, unit * 12) + unit * 5 < width
            ? "middle"
            : "all",
      );
    };
    const observer = new ResizeObserver(update);
    observer.observe(container);
    observer.observe(ruler);
    update();
    return () => observer.disconnect();
  }, [items]);
  if (!items.length) return null;
  const lastIndex = items.length - 1;
  const hidden =
    mode === "full"
      ? []
      : items
          .map((_, index) => index)
          .filter(
            (index) => index < lastIndex && (mode === "all" || index > 0),
          );
  const visible: (number | "menu")[] = hidden.length
    ? [...(mode === "middle" ? [0] : []), "menu", lastIndex]
    : items.map((_, index) => index);
  const separator = (
    <RiArrowRightSLine aria-hidden className="size-4 shrink-0 text-faint" />
  );
  return (
    <nav
      ref={nav}
      aria-label="Хлебные крошки"
      className="relative min-w-0 flex-1 overflow-hidden text-sm"
    >
      <ol
        ref={measure}
        aria-hidden
        className="pointer-events-none invisible absolute flex w-max list-none items-center gap-1 whitespace-nowrap p-0"
        style={{ top: 0 }}
      >
        {items.map((item, index) => (
          <li
            key={index}
            className={`flex items-center gap-1 ${index === lastIndex ? "font-medium" : ""}`}
          >
            {index > 0 && separator}
            <span>{item.label}</span>
          </li>
        ))}
      </ol>
      <ol className="m-0 flex min-w-0 list-none items-center gap-1 p-0">
        {visible.map((index, position) => (
          <li
            key={index}
            className={`flex min-w-0 items-center gap-1 ${index === lastIndex ? "flex-1" : "shrink-0"}`}
          >
            {position > 0 && separator}
            {index === "menu" ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Предыдущие страницы"
                  >
                    <RiMoreLine />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {hidden.map((i) =>
                    items[i].to ? (
                      <DropdownMenuItem key={i} asChild>
                        <Link
                          to={items[i].to!}
                          state={crumbStateFor(items, i)}
                          className="max-w-sm whitespace-normal break-words"
                        >
                          {items[i].label}
                        </Link>
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem key={i} disabled>
                        {items[i].label}
                      </DropdownMenuItem>
                    ),
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : index === lastIndex ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    tabIndex={0}
                    aria-current="page"
                    className="min-w-0 truncate rounded-sm font-medium text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    {items[index].label}
                  </span>
                </TooltipTrigger>
                <TooltipContent>{items[index].label}</TooltipContent>
              </Tooltip>
            ) : items[index].to ? (
              <Link
                to={items[index].to!}
                state={crumbStateFor(items, index)}
                className="rounded-sm text-muted-foreground no-underline hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              >
                {items[index].label}
              </Link>
            ) : (
              <span className="text-faint">{items[index].label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
