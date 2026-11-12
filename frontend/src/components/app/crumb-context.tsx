import {
  createContext,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useMatches, useResolvedPath } from "react-router";
import {
  sectionAs,
  sectionByKey,
  sectionForPath,
  sectionListFor,
} from "@/util/sections";
import {
  buildCrumbTrail,
  crumbReturnOrigin,
  currentCrumbAddress,
  crumbPath,
  crumbSourceState,
  readCrumbState,
  type CrumbLink,
  type CrumbOrigin,
} from "@/util/crumb-trail";
import { useAuthedUser, useCan } from "@/store/authed-user";

type PageCrumbs = {
  title?: string;
  section?: string | false;
  chain?: CrumbLink[];
};
type Registration = PageCrumbs & { path: string };
type CrumbContextValue = {
  items: CrumbLink[];
  owner: string;
  origin?: CrumbOrigin;
  register: (id: string, value?: Registration) => void;
};
const CrumbContext = createContext<CrumbContextValue | null>(null);
export const useCrumbContext = () => useContext(CrumbContext);

/** Route metadata defines the hierarchy; History state holds source and saved filters. */
export function CrumbProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const matches = useMatches();
  const can = useCan();
  const { isEndUser } = useAuthedUser();
  const owner =
    [...matches]
      .reverse()
      .find(
        (match) => !(match.handle as { sheet?: unknown } | undefined)?.sheet,
      )?.pathname ?? location.pathname;
  const [pages, setPages] = useState<Record<string, Registration>>({});
  const register = useCallback((id: string, value?: Registration) => {
    setPages((previous) => {
      if (JSON.stringify(previous[id]) === JSON.stringify(value))
        return previous;
      const next = { ...previous };
      if (value)
        next[id] = Object.fromEntries(
          Object.entries(value).filter(([, entry]) => entry !== undefined),
        ) as Registration;
      else delete next[id];
      return next;
    });
  }, []);
  const page = Object.values(pages)
    .filter((item) => crumbPath(item.path) === crumbPath(owner))
    .reduce<PageCrumbs>((result, item) => ({ ...result, ...item }), {});
  const section =
    page.section === false
      ? undefined
      : sectionAs(
          sectionByKey(page.section) ?? sectionForPath(owner),
          isEndUser,
        );
  const fallback = section
    ? {
        label: section.label,
        ...(section.can && !can(section.can) ? {} : { to: section.listTo }),
      }
    : undefined;
  const title =
    page.title ||
    sectionListFor(owner)?.label ||
    (owner.startsWith("/preferences")
      ? "Настройки системы"
      : owner.startsWith("/my-account")
        ? "Мой аккаунт"
        : section?.label || "Главная");
  const incoming = readCrumbState(location.state);
  // A list link can become inaccessible after a permissions update. Entity
  // access remains the responsibility of its route/server, not list rights.
  const permitted = (item: CrumbLink): boolean => {
    const list = item.to && sectionListFor(crumbPath(item.to));
    return (
      !list ||
      ((!list.can || can(list.can)) && !(isEndUser && list.endUserSection))
    );
  };
  if (incoming.crumbTrail)
    incoming.crumbTrail = incoming.crumbTrail.filter(permitted);
  if (incoming.from && !permitted(incoming.from)) delete incoming.from;
  if (incoming.returnContext && !permitted(incoming.returnContext.from))
    delete incoming.returnContext;
  const items = buildCrumbTrail({
    current: {
      label: title,
      to: currentCrumbAddress(owner, location, incoming),
    },
    section: fallback,
    chain: page.chain,
    state: incoming,
  });
  const encoded = JSON.stringify(items);
  const encodedOrigin = JSON.stringify(
    crumbReturnOrigin(incoming, owner, items),
  );
  const value = useMemo(
    () => ({
      items: JSON.parse(encoded) as CrumbLink[],
      origin: encodedOrigin
        ? (JSON.parse(encodedOrigin) as CrumbOrigin)
        : undefined,
      owner,
      register,
    }),
    [encoded, encodedOrigin, owner, register],
  );
  return (
    <CrumbContext.Provider value={value}>{children}</CrumbContext.Provider>
  );
}

export function usePageCrumbs(value: PageCrumbs) {
  const context = useCrumbContext();
  const id = useId();
  const path = useResolvedPath(".").pathname;
  const register = context?.register;
  // Inline chains are common in callers; don't re-register on every render.
  const encoded = JSON.stringify(value);
  useLayoutEffect(() => {
    register?.(id, { ...(JSON.parse(encoded) as PageCrumbs), path });
    return () => register?.(id);
  }, [register, id, path, encoded]);
}

export function useCrumbFrom(label?: string | null) {
  const context = useCrumbContext();
  const own = useResolvedPath(".").pathname;
  const location = useLocation();
  return useMemo(() => {
    if (!label && !context) return undefined;
    const current = {
      label: label || context?.items.at(-1)?.label || "Главная",
      to: context?.items.at(-1)?.to ?? `${own}${location.search}`,
    };
    return crumbSourceState(context?.items ?? [], current, context?.origin);
  }, [label, context, own, location.search]);
}
