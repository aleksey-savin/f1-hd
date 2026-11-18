/** Only filter fields travel with navigation; records and store actions never do. */
const fields: Record<string, readonly string[]> = {
  "/users": [
    "audience",
    "company",
    "roles",
    "online",
    "activity",
    "activeOnly",
    "service",
    "pro32",
    "groupBySubdivision",
    "searchTerm",
    "page",
    "sortBy",
    "sortingOptions",
  ],
  "/inventory/client-devices": ["facets", "searchTerm", "page", "sortBy"],
  "/inventory/locations": [
    "selectedCompanyIds",
    "showWorkplaces",
    "typeFilters",
    "status",
    "publicOnly",
    "subdivision",
    "searchTerm",
    "sortBy",
  ],
  "/routine-tasks": [
    "status",
    "categories",
    "companies",
    "searchTerm",
    "sortBy",
  ],
  "/devices/mikrotik": ["facets", "searchTerm", "sortBy"],
  "/knowledge-base": [
    "companies",
    "users",
    "categories",
    "enabledTypes",
    "searchTerm",
    "sortBy",
    "moderationMode",
    "scope",
    "expandedGroups",
    "openCompany",
  ],
};

export type ListSnapshot = { path: string; values: Record<string, unknown> };
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function readListSnapshot(value: unknown): ListSnapshot | undefined {
  if (
    !object(value) ||
    typeof value.path !== "string" ||
    !fields[value.path] ||
    !object(value.values)
  )
    return undefined;
  return { path: value.path, values: value.values };
}

export function captureListFilters(
  path: string,
  state: Record<string, unknown>,
): ListSnapshot {
  return {
    path,
    values: Object.fromEntries(
      (fields[path] ?? [])
        .filter((key) => key in state)
        .map((key) => [key, state[key]]),
    ),
  };
}

function compatible(value: unknown, initial: unknown, key: string): boolean {
  if (initial === null) {
    if (key === "subdivision")
      return (
        value === null ||
        (object(value) &&
          typeof value._id === "string" &&
          typeof value.name === "string")
      );
    return value === null || typeof value === "string";
  }
  if (Array.isArray(initial)) {
    if (!Array.isArray(value)) return false;
    return value.every(
      (entry) =>
        typeof entry === "string" ||
        (object(entry) &&
          (typeof entry._id === "string" || typeof entry.label === "string") &&
          Object.entries(entry).every(
            ([name, field]) =>
              field === null ||
              ["string", "boolean", "number"].includes(typeof field) ||
              (name === "company" &&
                object(field) &&
                typeof field._id === "string" &&
                typeof field.alias === "string"),
          )),
    );
  }
  if (object(initial))
    return (
      object(value) &&
      Object.entries(initial).every(([field, sample]) =>
        compatible(value[field], sample, field),
      )
    );
  if (typeof initial === "number")
    return typeof value === "number" && Number.isFinite(value) && value >= 1;
  return typeof value === typeof initial;
}

export function restoreListFilters(
  path: string,
  value: unknown,
  initial: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const snapshot = readListSnapshot(value);
  if (!snapshot || snapshot.path !== path) return undefined;
  return Object.fromEntries(
    (fields[path] ?? [])
      .filter(
        (key) =>
          key in snapshot.values &&
          key in initial &&
          compatible(snapshot.values[key], initial[key], key),
      )
      .map((key) => [key, snapshot.values[key]]),
  );
}

/** A company crumb means the whole company, not the previous search/facets. */
export function companyListFilters(
  path: string,
  initial: Record<string, unknown>,
  company: string,
): Record<string, unknown> {
  const defaults = captureListFilters(path, initial).values;
  switch (path) {
    case "/users":
      return {
        ...defaults,
        company,
        audience: "all",
        activeOnly: false,
        service: "any",
        page: 1,
        sortingOptions: [
          { label: "По имени" },
          { label: "Недавно активные" },
          { label: "Сначала новые" },
        ],
      };
    case "/inventory/client-devices":
      return {
        ...defaults,
        facets: {
          ...(initial.facets as Record<string, unknown>),
          companies: [company],
          components: "any",
        },
        page: 1,
      };
    case "/inventory/locations":
      return {
        ...defaults,
        selectedCompanyIds: [company],
        showWorkplaces: true,
      };
    case "/routine-tasks":
      return { ...defaults, companies: [company] };
    case "/devices/mikrotik":
      return {
        ...defaults,
        facets: {
          ...(initial.facets as Record<string, unknown>),
          companies: [company],
        },
      };
    case "/knowledge-base":
      return {
        ...defaults,
        companies: [{ _id: company }],
        expandedGroups: [],
        openCompany: null,
      };
    default:
      return defaults;
  }
}
