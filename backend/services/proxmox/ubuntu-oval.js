// Canonical USN OVAL describes binary packages, not source-package OSV ranges.
const { XMLParser, XMLValidator } = require("fast-xml-parser");
const { compareDebianVersions } = require("./deb-version");
const MAX_XML = 64 * 1024 * 1024;
const children = (node, name) =>
  (node?.children || []).filter((n) => n.name === name);
const child = (node, name) => children(node, name)[0];
const parseUbuntuOval = (buffer) => {
  if (buffer.length > MAX_XML)
    throw new Error("База Ubuntu OVAL слишком большая");
  const xml = buffer.toString("utf8");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true)
    throw new Error("Некорректная база Ubuntu OVAL");
  const raw = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: "",
    removeNSPrefix: true,
    parseTagValue: false,
    processEntities: false,
  }).parse(xml);
  let count = 0;
  const convert = (items, depth = 0) => {
    if (depth > 64) throw new Error("Слишком глубокая структура Ubuntu OVAL");
    return items
      .filter((n) => !("#text" in n) && !Object.keys(n)[0].startsWith("?"))
      .map((n) => {
        if (++count > 500000)
          throw new Error("База Ubuntu OVAL слишком большая");
        const name = Object.keys(n).find((k) => k !== ":@");
        return {
          name,
          attrs: n[":@"] || {},
          text: n[name]
            .filter((x) => "#text" in x)
            .map((x) => x["#text"])
            .join("")
            .trim(),
          children: convert(n[name], depth + 1),
        };
      });
  };
  const root = convert(raw)[0];
  if (
    root?.name !== "oval_definitions" ||
    !children(child(root, "definitions"), "definition").length
  )
    throw new Error("Пустая база Ubuntu OVAL");
  return root;
};
const evaluateUbuntuOval = (inventory, feed) => {
  if (inventory.os.id !== "ubuntu" || inventory.os.version !== feed.version)
    throw new Error("База Ubuntu OVAL не соответствует выпуску ОС");
  const root = feed.oval;
  const index = (name) =>
    new Map((child(root, name)?.children || []).map((n) => [n.attrs.id, n]));
  const definitions = index("definitions"),
    tests = index("tests"),
    objects = index("objects"),
    states = index("states"),
    variables = index("variables");
  const result = (value, packages = [], uncertainPackages = []) => ({
    value,
    packages,
    uncertainPackages,
  });
  const combine = (items, operator = "AND") => {
    if (!items.length || !["AND", "OR"].includes(operator)) return result(null);
    const value =
      operator === "AND"
        ? items.some((x) => x.value === false)
          ? false
          : items.every((x) => x.value === true)
            ? true
            : null
        : items.some((x) => x.value === true)
          ? true
          : items.every((x) => x.value === false)
            ? false
            : null;
    if (value === false) return result(false);
    if (value === null)
      return result(
        null,
        items
          .filter((x) => x.value !== false)
          .flatMap((x) => [...x.packages, ...x.uncertainPackages]),
      );
    return result(
      true,
      items.filter((x) => x.value === true).flatMap((x) => x.packages),
      items
        .filter((x) => x.value !== false)
        .flatMap((x) =>
          x.value === null
            ? [...x.packages, ...x.uncertainPackages]
            : x.uncertainPackages,
        ),
    );
  };
  const evaluateTest = (id) => {
    const test = tests.get(id),
      object = objects.get(child(test, "object")?.attrs.object_ref),
      state = states.get(child(test, "state")?.attrs.state_ref);
    if (!test || !object || !state) return result(null);
    // Recognise the release inventory tests only from their actual data, never comments or IDs.
    if (
      test.name === "family_test" &&
      object.name === "family_object" &&
      child(state, "family")?.text === "unix"
    )
      return result(true);
    if (
      test.name === "textfilecontent54_test" &&
      child(object, "filepath")?.text === "/etc/lsb-release" &&
      child(object, "pattern")?.text ===
        "^[\\s\\S]*DISTRIB_CODENAME=([a-z]+)$" &&
      child(state, "subexpression")?.attrs.operation === "equals"
    )
      return result(child(state, "subexpression").text === feed.codename);
    if (
      test.name !== "dpkginfo_test" ||
      object.name !== "dpkginfo_object" ||
      state.name !== "dpkginfo_state" ||
      test.attrs.check !== "at least one" ||
      !["at_least_one_exists", undefined].includes(
        test.attrs.check_existence,
      ) ||
      children(test, "state").length !== 1 ||
      children(test, "object").length !== 1
    )
      return result(null);
    const name = child(object, "name");
    if (
      !name ||
      object.children.length !== 1 ||
      (name.attrs.operation && name.attrs.operation !== "equals")
    )
      return result(null);
    const variable = variables.get(name.attrs.var_ref);
    const names = name.attrs.var_ref
      ? variable?.name === "constant_variable" &&
        variable.attrs.datatype === "string" &&
        name.attrs.var_check === "at least one"
        ? children(variable, "value").map((n) => n.text)
        : null
      : [name.text];
    if (!names || names.some((n) => !/^[a-z0-9][a-z0-9+.-]*$/.test(n)))
      return result(null);
    const installed = inventory.packages.filter((p) => names.includes(p.name));
    if (!installed.length) return result(false);
    const evr = child(state, "evr");
    if (
      !evr ||
      children(state, "evr").length !== 1 ||
      children(state, "arch").length > 1 ||
      evr.attrs.operation !== "less than" ||
      evr.attrs.datatype !== "debian_evr_string" ||
      evr.attrs.var_ref ||
      state.children.some((n) => !["evr", "arch"].includes(n.name)) ||
      (state.attrs.operator && state.attrs.operator !== "AND")
    )
      return result(null, installed);
    const arch = child(state, "arch");
    const matches = installed.map((p) => {
      let vulnerable;
      try {
        vulnerable = compareDebianVersions(p.version, evr.text) < 0;
      } catch {
        return result(null, [p]);
      }
      if (!vulnerable) return result(false);
      const pkg = { ...p, fixedVersion: evr.text };
      if (
        arch &&
        (arch.attrs.var_ref ||
          (arch.attrs.operation && arch.attrs.operation !== "equals") ||
          !p.architecture)
      )
        return result(null, [pkg]);
      if (arch && p.architecture !== arch.text) return result(false);
      return result(/[+~.-](?:pmx|pve)\d/.test(p.version) ? null : true, [pkg]);
    });
    return combine(matches, "OR");
  };
  const evaluate = (node, seen = new Set()) => {
    if (!node || node.attrs.negate === "true") return result(null);
    if (node.name === "criterion") return evaluateTest(node.attrs.test_ref);
    if (node.name === "extend_definition") {
      const id = node.attrs.definition_ref;
      if (seen.has(id) || seen.size > 64) return result(null);
      return evaluate(
        child(definitions.get(id), "criteria"),
        new Set([...seen, id]),
      );
    }
    if (node.name !== "criteria") return result(null);
    return combine(
      node.children.map((n) => evaluate(n, seen)),
      node.attrs.operator || "AND",
    );
  };
  const findings = new Map(),
    review = new Map();
  for (const definition of definitions.values()) {
    if (!["patch", "vulnerability"].includes(definition.attrs.class)) continue;
    const outcome = evaluate(child(definition, "criteria"));
    if (
      outcome.value === false ||
      (!outcome.packages.length && !outcome.uncertainPackages.length)
    )
      continue;
    const metadata = child(definition, "metadata");
    const ids = children(metadata, "reference")
      .filter(
        (n) =>
          n.attrs.source === "CVE" && /^CVE-\d{4}-\d{4,}$/.test(n.attrs.ref_id),
      )
      .map((n) => n.attrs.ref_id);
    for (const id of ids) {
      const rating = children(child(metadata, "advisory"), "cve").find(
        (n) => n.text === id,
      );
      for (const [target, packages] of [
        [outcome.value === true ? findings : review, outcome.packages],
        [review, outcome.uncertainPackages],
      ]) {
        if (!packages.length) continue;
        if (!target.has(id))
          target.set(id, {
            id,
            url: `https://ubuntu.com/security/${id}`,
            severity: rating?.attrs.priority || "unknown",
            packages: [],
            updates: [],
          });
        const finding = target.get(id);
        for (const p of packages)
          if (
            !finding.packages.some(
              (x) => x.name === p.name && x.version === p.version,
            )
          )
            finding.packages.push(p);
      }
    }
  }
  for (const [id, finding] of review) {
    const confirmed = findings.get(id)?.packages || [];
    finding.packages = finding.packages.filter(
      (p) =>
        !confirmed.some((x) => x.name === p.name && x.version === p.version),
    );
    if (!finding.packages.length) review.delete(id);
  }
  return {
    status: "partial",
    limitations: ["Проверены опубликованные исправления Ubuntu USN. Уязвимости без исправления и неподдерживаемые условия OVAL не входят в подтверждённые результаты."],
    kernelCovered: false,
    os: inventory.os,
    packageCount: inventory.packages.length,
    source: feed.source,
    feedUpdatedAt: feed.fetchedAt,
    scope: "Пакеты гостевой ОС · опубликованные исправления Ubuntu USN",
    findings: [...findings.values()],
    reviewFindings: [...review.values()],
    updates: [],
  };
};
module.exports = { parseUbuntuOval, evaluateUbuntuOval, MAX_XML };
