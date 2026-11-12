export type CrumbLink = { label: string; to?: string };
export type CrumbOrigin = { label: string; to: string };
export type CrumbState = { crumbTrail?: CrumbLink[]; from?: CrumbOrigin };

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
  return result;
}

export const crumbPath = (to: string) =>
  to.split(/[?#]/, 1)[0].replace(/\/$/, "") || "/";

/** A path, not a visit log: revisiting an ancestor removes its old descendants. */
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
  const base =
    origin.crumbTrail ??
    (origin.from ? [origin.from] : [...(section ? [section] : []), ...chain]);
  const same = (left: CrumbLink, right: CrumbLink) =>
    left.to && right.to
      ? crumbPath(left.to) === crumbPath(right.to)
      : !left.to && !right.to && left.label === right.label;
  // Enrich an incoming branch with missing hierarchy (for example a location's
  // company), without dropping the page the user came from. Insert before the
  // next known ancestor, or before the current page when revisiting it.
  chain.forEach((ancestor, index) => {
    if (base.some((item) => same(item, ancestor))) return;
    const next = chain
      .slice(index + 1)
      .find((item) => base.some((existing) => same(existing, item)));
    const insertAt = base.findIndex((item) => same(item, next ?? current));
    base.splice(insertAt < 0 ? base.length : insertAt, 0, ancestor);
  });
  const items: CrumbLink[] = [];
  for (const item of [...base, current]) {
    const index = item.to
      ? items.findIndex(
          (previous) =>
            previous.to && crumbPath(previous.to) === crumbPath(item.to!),
        )
      : -1;
    if (index >= 0) items.splice(index);
    const ticketNumber =
      item.to && /^\/tickets\/(\d+)$/.exec(crumbPath(item.to))?.[1];
    items.push(ticketNumber ? { ...item, label: ticketNumber } : item);
  }
  return items;
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
