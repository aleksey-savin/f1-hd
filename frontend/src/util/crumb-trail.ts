export type CrumbLink = { label: string; to?: string };
export type CrumbOrigin = { label: string; to: string };
export type CrumbState = {
  crumbTrail?: CrumbLink[];
  from?: CrumbOrigin;
  returnContext?: { to: string; from: CrumbOrigin };
};

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export function isCrumbAddress(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\") &&
    ![...value].some((character) => character.charCodeAt(0) <= 32)
  );
}

/** History state is an external boundary (old clients and arbitrary callers). */
export function readCrumbState(value: unknown): CrumbState {
  if (!record(value)) return {};
  const result: CrumbState = {};
  const valid = (item: unknown): item is CrumbLink =>
    record(item) &&
    typeof item.label === "string" &&
    item.label.trim().length > 0 &&
    (item.to === undefined || isCrumbAddress(item.to));
  if (
    Array.isArray(value.crumbTrail) &&
    value.crumbTrail.length > 0 &&
    value.crumbTrail.every(valid)
  ) {
    result.crumbTrail = value.crumbTrail.map(({ label, to }) => ({
      label,
      to,
    }));
  }
  if (valid(value.from) && value.from.to)
    result.from = { label: value.from.label, to: value.from.to };
  const context = value.returnContext;
  if (
    record(context) &&
    isCrumbAddress(context.to) &&
    valid(context.from) &&
    context.from.to
  ) {
    result.returnContext = {
      to: context.to,
      from: { label: context.from.label, to: context.from.to },
    };
  }
  return result;
}

export const crumbPath = (to: string) =>
  to.split(/[?#]/, 1)[0].replace(/\/$/, "") || "/";

/** Only actual parents define breadcrumbs. History supplies saved ancestor filters. */
export function buildCrumbTrail({
  current,
  section,
  chain = [],
  state,
}: {
  current: CrumbOrigin;
  section?: CrumbLink;
  chain?: CrumbLink[];
  state?: unknown;
}): CrumbLink[] {
  const origin = readCrumbState(state);
  const saved = origin.crumbTrail ?? (origin.from ? [origin.from] : []);
  const declaredParents = [...(section ? [section] : []), ...chain];
  const parents = declaredParents
    .filter(
      (item) =>
        !item.to ||
        crumbPath(item.to) !== crumbPath(current.to) ||
        item.to.includes("#"),
    )
    .map((item) => {
      if (!item.to || /[?#]/.test(item.to)) return item;
      const previous =
        saved.find((entry) => entry.to === item.to) ??
        [...saved]
          .reverse()
          .find(
            (entry) =>
              entry.to &&
              crumbPath(entry.to) === crumbPath(item.to!) &&
              !declaredParents.some(
                (parent) => parent !== item && parent.to === entry.to,
              ),
          );
      return previous?.to ? { ...item, to: previous.to } : item;
    });
  const items: CrumbLink[] = [];
  for (const item of [...parents, current]) {
    const duplicate = items.findIndex((previous) =>
      item.to
        ? previous.to === item.to
        : !previous.to && previous.label === item.label,
    );
    if (duplicate >= 0) items.splice(duplicate);
    const ticketNumber =
      item.to && /^\/tickets\/(\d+)$/.exec(crumbPath(item.to))?.[1];
    items.push(ticketNumber ? { ...item, label: ticketNumber } : item);
  }
  return items;
}

/** The immediate source is a separate action; ancestors already have a link. */
export function crumbReturnOrigin(
  state: unknown,
  current: string,
  hierarchy: CrumbLink[],
): CrumbOrigin | undefined {
  const source = readCrumbState(state);
  const origin =
    source.returnContext &&
    crumbPath(source.returnContext.to) === crumbPath(current)
      ? source.returnContext.from
      : source.from;
  if (
    !origin ||
    crumbPath(origin.to) === crumbPath(current) ||
    hierarchy.some(
      (item) => item.to && crumbPath(item.to) === crumbPath(origin.to),
    )
  )
    return undefined;
  const ticketNumber = /^\/tickets\/(\d+)$/.exec(crumbPath(origin.to))?.[1];
  return ticketNumber ? { ...origin, label: ticketNumber } : origin;
}

export function crumbStateFor(
  items: CrumbLink[],
  index = items.length - 1,
): CrumbState {
  const from = items
    .slice(0, index)
    .reverse()
    .find((item) => item.to);
  return {
    crumbTrail: items.slice(0, index + 1),
    ...(from?.to ? { from: { label: from.label, to: from.to } } : {}),
  };
}

/** A sheet's query belongs to its form; the background keeps its own address. */
export function currentCrumbAddress(
  owner: string,
  location: { pathname: string; search: string; hash: string },
  state: unknown,
): string {
  if (crumbPath(owner) === crumbPath(location.pathname))
    return `${owner}${location.search}${location.hash}`;
  const source = readCrumbState(state);
  return (
    [...(source.crumbTrail ?? (source.from ? [source.from] : []))]
      .reverse()
      .find((item) => item.to && crumbPath(item.to) === crumbPath(owner))?.to ??
    owner
  );
}

/** Query-only navigation keeps the current entry's context unless explicitly reset. */
export function preserveCrumbState(
  current: unknown,
  requested: unknown,
): unknown {
  return requested === undefined ? current : requested;
}

type CrumbCompany = {
  _id?: string;
  id?: string;
  alias?: string;
  fullTitle?: string;
  name?: string;
};

/** Multiple bindings describe scope, not a chain of companies owning each other. */
export function companyCrumbs(
  companies: readonly (CrumbCompany | null | undefined)[],
  canRead: boolean,
): CrumbLink[] {
  const entries = companies.flatMap((company) => {
    const label = company?.alias || company?.name || company?.fullTitle;
    if (!label) return [];
    const id = company?._id || company?.id;
    return [{ label, ...(id && canRead ? { to: `/companies/${id}` } : {}) }];
  });
  if (entries.length <= 1) return entries;
  return [{ label: entries.map((item) => item.label).join(", ") }];
}

/** Keep the source of a background page when a form temporarily becomes its child. */
export function crumbSourceState(
  items: CrumbLink[],
  current: CrumbOrigin,
  returnTo?: CrumbOrigin,
): CrumbState & { from: CrumbOrigin } {
  return {
    crumbTrail: items.length ? [...items.slice(0, -1), current] : [current],
    from: current,
    ...(returnTo ? { returnContext: { to: current.to, from: returnTo } } : {}),
  };
}
