import { test } from "node:test";
import assert from "node:assert/strict";
import { formatTaxiAddress } from "./address.ts";
test("taxi labels omit country and Primorsky region prefixes, preserving the city and building", () => {
  assert.equal(
    formatTaxiAddress(
      "Россия, Приморский край, Владивосток, Пограничная улица, 15В",
    ),
    "Владивосток, Пограничная улица, 15В",
  );
  assert.equal(
    formatTaxiAddress("Приморский край, Владивосток, улица Толстого, 23"),
    "Владивосток, улица Толстого, 23",
  );
  assert.equal(
    formatTaxiAddress(
      "  российская федерация , ПРИМОРСКИЙ КРАЙ , Артём, улица Ленина, 2/1",
    ),
    "Артём, улица Ленина, 2/1",
  );
});
test("formatting does not remove street names, other regions or cities", () => {
  assert.equal(
    formatTaxiAddress("Россия, Московская область, Химки, улица Россия, 12"),
    "Московская область, Химки, улица Россия, 12",
  );
  assert.equal(
    formatTaxiAddress("Владивосток, Приморский край, 12"),
    "Владивосток, Приморский край, 12",
  );
  assert.equal(formatTaxiAddress(undefined), "");
});
