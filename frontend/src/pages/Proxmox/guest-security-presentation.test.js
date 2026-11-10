import test from "node:test";
import assert from "node:assert/strict";
import {
  securityHeading,
  securityNotes,
  securitySummary,
} from "./guest-security-presentation.js";
test("CVE warnings use the configured severity while keeping unscored results visible", () => {
  const report = {
    status: "completed",
    minSeverity: "critical",
    findingCount: 10,
    alertFindingCount: 0,
    unknownSeverityCount: 2,
  };
  assert.equal(securityHeading(report), "CVE уровня Critical не найдены");
  assert.equal(securitySummary(report), "CVE уровня Critical не найдены");
  assert.match(
    securityHeading({ ...report, alertFindingCount: 1 }),
    /1 уязвимость.*Critical/,
  );
  assert.equal(
    securityHeading({ ...report, findingCount: 2 }),
    "2 CVE без оценки опасности",
  );
});
test("failed and incomplete scans never present an empty old report as a clean result", () => {
  assert.equal(securityHeading(null), "CVE ещё не проверены");
  assert.equal(
    securityHeading({
      status: "completed",
      findings: [],
      reviewFindings: [{ id: "CVE-2025-11111" }],
    }),
    "Есть CVE, требующие проверки",
  );
  assert.equal(
    securityHeading({ status: "error", findings: [] }),
    "Не удалось проверить CVE",
  );
  assert.equal(
    securityHeading({ status: "partial", findings: [] }),
    "Не удалось завершить проверку CVE",
  );
  assert.equal(
    securityHeading({ status: "completed", findings: [] }),
    "Уязвимости не найдены",
  );
  assert.equal(
    securityHeading({
      status: "completed",
      findings: [{ id: "CVE-2025-12345" }],
    }),
    "Найдена 1 уязвимость",
  );
});
test("partial results keep known CVEs first and name the actual missing check", () => {
  const report = {
    status: "partial",
    findings: [{ id: "CVE-2025-12345" }],
    os: { id: "debian", kernel: "7.0.6-2-pve" },
    kernelCovered: false,
  };
  assert.equal(securityHeading(report), "Найдена 1 уязвимость");
  assert.match(securityNotes(report)[0].text, /7\.0\.6-2-pve/);
  assert.match(securityNotes(report)[0].hint, /автоматическая проверка/i);
  assert.equal(securitySummary(report), "1 · ядро Linux не проверено");
});
test("an unmapped Windows update tells the user which update to install", () => {
  const report = {
    status: "partial",
    findings: [],
    baselineCovered: true,
    os: { id: "mswindows" },
    updates: [
      {
        id: "u",
        security: true,
        cves: [],
        kb: ["5128923"],
        title: "Cumulative .NET Framework update",
      },
    ],
  };
  const note = securityNotes(report)[0];
  assert.match(note.text, /\.NET Framework.*KB5128923/);
  assert.match(note.hint, /Установите.*CVE/);
  assert.equal(securityHeading(report), "Доступно обновление .NET Framework");
  assert.doesNotMatch(securitySummary(report), /неполная|не найдены/);
});
test("a required reboot gives an action instead of calling the CVE scan incomplete", () => {
  const report = {
    status: "partial",
    findings: [],
    os: { id: "mswindows" },
    baselineCovered: true,
    rebootRequired: true,
    updates: [],
  };
  assert.equal(securityHeading(report), "Нужна перезагрузка Windows");
  assert.match(securityNotes(report)[0].hint, /Перезагрузите ВМ/);
});
