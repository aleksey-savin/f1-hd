import { test } from "node:test";
import assert from "node:assert/strict";
import {
  companyListFilters,
  captureListFilters,
  restoreListFilters,
} from "./list-crumb-filters.ts";

test("company user scope clears all restrictions and pagination", () => {
  const initial = {
    audience: "clients",
    activeOnly: true,
    service: "hide",
    company: null,
    searchTerm: "",
    roles: [],
    online: false,
    activity: "any",
    pro32: false,
    groupBySubdivision: false,
    page: 1,
    sortBy: { label: "По имени" },
    sortingOptions: [],
  };
  const next = companyListFilters("/users", initial, "c1");
  assert.equal(next.company, "c1");
  assert.equal(next.audience, "all");
  assert.equal(next.activeOnly, false);
  assert.equal(next.service, "any");
  assert.equal(next.searchTerm, "");
  assert.equal(next.page, 1);
});

test("company devices include components; locations include workplaces", () => {
  assert.deepEqual(
    companyListFilters(
      "/inventory/client-devices",
      {
        facets: { companies: [], components: "hide", users: [] },
        searchTerm: "",
        page: 1,
      },
      "c1",
    ).facets,
    { companies: ["c1"], components: "any", users: [] },
  );
  const locations = companyListFilters(
    "/inventory/locations",
    {
      selectedCompanyIds: [],
      showWorkplaces: false,
      status: "all",
      searchTerm: "",
    },
    "c2",
  );
  assert.deepEqual(locations.selectedCompanyIds, ["c2"]);
  assert.equal(locations.showWorkplaces, true);
});

test("other store-backed sections select company and clear prior scope", () => {
  assert.deepEqual(
    companyListFilters(
      "/routine-tasks",
      { companies: [], status: "all", categories: [], searchTerm: "" },
      "c1",
    ).companies,
    ["c1"],
  );
  assert.deepEqual(
    companyListFilters(
      "/devices/mikrotik",
      { facets: { companies: [], status: null }, searchTerm: "" },
      "c1",
    ).facets,
    { companies: ["c1"], status: null },
  );
  const kb = companyListFilters(
    "/knowledge-base",
    {
      companies: [],
      users: [],
      categories: [],
      enabledTypes: {},
      searchTerm: "",
      moderationMode: null,
      scope: "active",
      expandedGroups: [],
      openCompany: null,
    },
    "c1",
  );
  assert.deepEqual(kb.companies, [{ _id: "c1" }]);
  assert.equal(kb.openCompany, null);
  assert.equal(kb.moderationMode, null);
});

test("source snapshot restores exact original filters without copying records or actions", () => {
  const initial = {
    company: null,
    searchTerm: "",
    page: 1,
    roles: [],
    activeOnly: true,
  };
  const source = {
    ...initial,
    company: "old",
    searchTerm: "Иван",
    page: 4,
    items: [{ secret: "record" }],
    fetch() {},
  };
  const snapshot = JSON.parse(
    JSON.stringify(captureListFilters("/users", source)),
  );
  assert.deepEqual(restoreListFilters("/users", snapshot, initial), {
    ...initial,
    company: "old",
    searchTerm: "Иван",
    page: 4,
  });
  assert.equal("items" in snapshot.values, false);
  assert.equal(
    restoreListFilters("/routine-tasks", snapshot, initial),
    undefined,
  );
});

test("corrupt history cannot replace store actions or inject malformed filter shapes", () => {
  const restored = restoreListFilters(
    "/users",
    {
      path: "/users",
      values: {
        fetch: "bad",
        roles: "bad",
        page: "bad",
        searchTerm: {},
        company: [],
      },
    },
    { company: null, page: 1, roles: [], searchTerm: "" },
  );
  assert.deepEqual(restored, {});
});

test("knowledge user filter with company binding survives source return", () => {
  const users = [
    { _id: "u1", fullName: "Иван", company: { _id: "c1", alias: "Компания" } },
  ];
  const snapshot = captureListFilters("/knowledge-base", { users });
  assert.deepEqual(
    restoreListFilters("/knowledge-base", snapshot, { users: [] }),
    { users },
  );
});
