import test from "node:test";
import assert from "node:assert/strict";
import {
  securityHeading,
  securityOtherCounts,
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

test("report summary does not repeat unscored CVEs but preserves them during failures", () => {
  const report = {
    status: "completed",
    minSeverity: "high",
    findingCount: 2,
    unknownSeverityCount: 2,
    alertFindingCount: 0,
  };
  assert.equal(securityOtherCounts(report), null);
  assert.equal(
    securityOtherCounts({ ...report, status: "error" }),
    "Без оценки опасности: 2 CVE",
  );
  assert.equal(
    securityOtherCounts({ ...report, findingCount: 4, alertFindingCount: 1 }),
    "Ниже порога: 1 CVE · Без оценки опасности: 2 CVE",
  );
});
test("Windows DNS failure shows partial baseline coverage with a concrete next action", () => {
  const report = {
    status: "partial",
    os: { id: "mswindows" },
    findings: [],
    baselineCovered: true,
    windowsUpdate: { status: "error", errorCode: "8024402C" },
  };
  const notes = securityNotes(report);
  assert.match(notes[0].text, /DNS/);
  assert.match(notes[0].hint, /сборк/i);
  assert.doesNotMatch(securityHeading(report), /не найдены/);
});
test("limited official Linux sources and Proxmox rules remain visible alongside findings", () => {
  const report = {
    status: "partial",
    os: { id: "debian", kernel: "7.0.6-2-pve" },
    findings: [{ id: "CVE-2026-64564" }],
    kernelCovered: false,
    kernelAssessment: {
      kind: "proxmox-vendor-rules",
      rules: ["CVE-2026-64564"],
      note: "Проверен отдельный бюллетень Proxmox",
    },
    limitations: ["Проверены опубликованные исправления"],
  };
  const notes = securityNotes(report);
  assert.match(notes.find((n) => n.id === "kernel").text, /частично/);
  assert.ok(notes.some((n) => n.text === report.limitations[0]));
  assert.match(securityHeading(report), /Найдена/);
});
test("partly mapped .NET bundles do not hide unresolved component CVEs", () => {
  const report = {
    status: "partial",
    os: { id: "mswindows" },
    baselineCovered: true,
    updates: [
      {
        id: "bundle",
        title: ".NET Framework",
        kb: ["5128923"],
        security: true,
        cves: ["CVE-2025-12345"],
        cveCoverageIncomplete: true,
      },
    ],
  };
  assert.match(securityNotes(report)[0].text, /KB5128923/);
});
