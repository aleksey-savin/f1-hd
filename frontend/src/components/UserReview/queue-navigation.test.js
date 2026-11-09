import { test } from "node:test";
import assert from "node:assert/strict";
import { proposalReturnTo, changeReviewQuery } from "./queue-navigation.ts";

test("returning from a profile restores the default selected proposal and all queue filters", () => {
  const target = proposalReturnTo(
    "/users/review?companyId=company-7&kind=departure&status=all&page=3",
    "proposal-42",
  );
  const url = new URL(target, "https://hd.example");
  assert.equal(url.pathname, "/users/review");
  assert.equal(url.searchParams.get("selected"), "proposal-42");
  assert.equal(url.searchParams.get("companyId"), "company-7");
  assert.equal(url.searchParams.get("kind"), "departure");
  assert.equal(url.searchParams.get("status"), "all");
  assert.equal(url.searchParams.get("page"), "3");
});

test("profile return follows the displayed proposal when the queue URL still names another selection", () => {
  const target = proposalReturnTo(
    "/users/review?status=deferred&selected=old-proposal",
    "current-proposal",
  );
  const url = new URL(target, "https://hd.example");
  assert.deepEqual(url.searchParams.getAll("selected"), ["current-proposal"]);
  assert.equal(url.searchParams.get("status"), "deferred");
  assert.equal(
    proposalReturnTo("/users/review", "first-proposal"),
    "/users/review?selected=first-proposal",
  );
});

test("embedded ticket and analysis origins retain their own return URLs", () => {
  for (const target of [
    "/tickets/51713?tab=details",
    "/users/review/analysis?status=all&page=2",
  ]) {
    assert.equal(proposalReturnTo(target, "proposal-42"), target);
  }
});

test("text search resets pagination and selection while preserving the deferred company queue", () => {
  const original = new URLSearchParams(
    "companyId=company-7&status=deferred&kind=inactivity&page=3&selected=person",
  );
  const search = changeReviewQuery(original, "q", "  Алёна клиент  ");
  assert.equal(search.get("q"), "Алёна клиент");
  assert.equal(search.get("companyId"), "company-7");
  assert.equal(search.get("status"), "deferred");
  assert.equal(search.get("kind"), "inactivity");
  assert.equal(search.has("page"), false);
  assert.equal(search.has("selected"), false);
  assert.equal(original.get("page"), "3");
  const cleared = changeReviewQuery(search, "q", "");
  assert.equal(cleared.has("q"), false);
  assert.equal(cleared.get("companyId"), "company-7");
  const selected = changeReviewQuery(
    new URLSearchParams("q=Алёна&page=3"),
    "selected",
    "person",
  );
  assert.equal(selected.get("page"), "3");
  assert.equal(selected.get("q"), "Алёна");
});

test("changing filters while search is still a draft commits both choices together", () => {
  const original = new URLSearchParams(
    "companyId=company-a&status=pending&page=3",
  );
  const company = changeReviewQuery(
    original,
    "companyId",
    "company-b",
    "Алёна",
  );
  assert.equal(company.get("companyId"), "company-b");
  assert.equal(company.get("q"), "Алёна");
  const deferred = changeReviewQuery(company, "status", "deferred", "Алёна");
  assert.equal(deferred.get("companyId"), "company-b");
  assert.equal(deferred.get("q"), "Алёна");
  assert.equal(deferred.get("status"), "deferred");
  assert.equal(deferred.has("page"), false);
});
