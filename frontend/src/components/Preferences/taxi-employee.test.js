import { test } from "node:test";
import assert from "node:assert/strict";
import { taxiEmployeeName } from "./taxi-employee.ts";
test("employee names use Yandex full name, email and nickname instead of technical ids", () => {
  const employee = {
    externalId: "external-secret-id",
    userId: null,
    active: true,
  };
  assert.equal(
    taxiEmployeeName({
      ...employee,
      fullName: "Максим Гурьянов",
      email: "maxim@example.org",
    }),
    "Максим Гурьянов",
  );
  assert.equal(
    taxiEmployeeName({
      ...employee,
      firstName: "Максим",
      lastName: "Гурьянов",
    }),
    "Максим Гурьянов",
  );
  assert.equal(
    taxiEmployeeName({ ...employee, email: "maxim@example.org" }),
    "maxim@example.org",
  );
  assert.equal(taxiEmployeeName({ ...employee, nickname: "maxim" }), "maxim");
  assert.equal(taxiEmployeeName(employee), "Имя не указано");
});
