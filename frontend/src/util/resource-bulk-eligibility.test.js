import test from "node:test";
import assert from "node:assert/strict";
import {
  companySelectionReason,
  companyDestinationReason,
} from "./resource-bulk-eligibility.js";
const guest = (id, company, linked = false) => ({
  id,
  name: `VM ${id}`,
  companyId: company,
  clientDeviceId: linked ? "inventory" : null,
});
test("conflicting linked companies disable the whole selection by name", () => {
  assert.match(
    companySelectionReason([guest("1", "A", true), guest("2", "B", true)]),
    /VM 2/,
  );
});
test("linked guest permits same company but blocks clearing and reassignment", () => {
  const rows = [guest("1", "A", true), guest("2", "B")];
  assert.equal(companySelectionReason(rows), null);
  assert.equal(companyDestinationReason(rows, "A"), null);
  assert.match(companyDestinationReason(rows, ""), /VM 1/);
  assert.match(companyDestinationReason(rows, "B"), /VM 1/);
});
test("unlinked VMs and LXC support clearing company", () => {
  assert.equal(
    companyDestinationReason(
      [guest("1", "A"), { ...guest("2", "B"), guestType: "lxc" }],
      "",
    ),
    null,
  );
});
