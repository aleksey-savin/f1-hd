import { forwardRef, useCallback } from "react";
import {
  Link as RouterLink,
  useNavigate as useRouterNavigate,
  useSearchParams as useRouterSearchParams,
  useLocation,
  type URLSearchParamsInit,
  type SetURLSearchParams,
  type LinkProps,
  type NavigateFunction,
  type NavigateOptions,
  type To,
} from "react-router";
import { preserveCrumbState } from "@/util/crumb-trail";
import { useCrumbFrom } from "./crumb-context";

/** Content navigation carries its source. App menus use the router directly
 * to start a new branch. Explicit state always wins (including null to reset). */
export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { state, ...props },
  ref,
) {
  const origin = useCrumbFrom();
  return (
    <RouterLink
      {...props}
      ref={ref}
      state={state === null ? null : { ...origin, ...state }}
    />
  );
});

export function useNavigate(): NavigateFunction {
  const navigate = useRouterNavigate();
  const origin = useCrumbFrom();
  return useCallback(
    ((to: To | number, options?: NavigateOptions) => {
      if (typeof to === "number") return navigate(to);
      return navigate(to, {
        ...options,
        state:
          options?.state === null ? null : { ...origin, ...options?.state },
      });
    }) as NavigateFunction,
    [navigate, origin],
  );
}

/** Filters, tabs and pagination change this page, not its breadcrumb branch. */
export function useSearchParams(
  defaultInit?: URLSearchParamsInit,
): ReturnType<typeof useRouterSearchParams> {
  const [params, setParams] = useRouterSearchParams(defaultInit);
  const { state } = useLocation();
  const update = useCallback<SetURLSearchParams>(
    (next, options) => {
      setParams(next, {
        ...options,
        state: preserveCrumbState(state, options?.state),
      });
    },
    [setParams, state],
  );
  return [params, update];
}
