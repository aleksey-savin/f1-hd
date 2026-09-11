// node --test src/util/sections.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import { sectionAs, sectionByKey, sectionForPath } from "./sections.ts";

test("staff keep the tickets section as is", () => {
  const tickets = sectionByKey("tickets");
  assert.equal(sectionAs(tickets, false), tickets);
  assert.equal(sectionAs(tickets, undefined), tickets);
});

test("an end user is sent to the dashboard instead of the tickets list", () => {
  const home = sectionAs(sectionByKey("tickets"), true);
  assert.equal(home?.key, "dashboard");
  assert.equal(home?.listTo, "/dashboard");
});

test("a ticket card resolves through the path the same way", () => {
  assert.equal(
    sectionAs(sectionForPath("/tickets/51713"), true)?.key,
    "dashboard",
  );
  assert.equal(
    sectionAs(sectionForPath("/tickets/51713"), false)?.key,
    "tickets",
  );
});

test("sections without an end-user stand-in are untouched", () => {
  const archive = sectionByKey("archive");
  assert.equal(sectionAs(archive, true), archive);
  assert.equal(sectionAs(undefined, true), undefined);
});
