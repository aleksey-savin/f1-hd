// node --test services/mikrotik/changeRules.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { validateProposal, PLACEHOLDERS, DENIED_PATHS, MAX_COMMANDS } = require("./changeRules");

const add = (path, params) => ({ path, action: "add", params });
const errors = (commands) => validateProposal({ commands }).errors || [];

test("a WireGuard peer with a generated key is accepted", () => {
  const result = validateProposal({
    commands: [add("/interface wireguard peers", { interface: "wg1", "allowed-address": "10.0.55.20/32", "public-key": PLACEHOLDERS.publicKey, comment: "i_petrov" })],
  });
  assert.equal(result.ok, true);
  assert.equal(result.risk, "normal");
  assert.deepEqual(result.placeholders, [PLACEHOLDERS.publicKey]);
});

test("denied menus are refused by path prefix, however the path is spelled", () => {
  for (const path of ["/user", "/user group", "/system script", "/system  reboot", "system/reset-configuration", "/file", "/tool fetch", "/ip service", "/ppp secret", "/certificate", "/container", "/snmp community", "/radius", "/import", "/ip ssh"]) {
    assert.match(errors([add(path, { name: "x" })])[0], /not allowed/, path);
  }
  assert.equal(validateProposal({ commands: [add("/ip firewall address-list", { list: "a", address: "10.0.0.1" })] }).ok, true);
});

test("script fields and literal secrets are refused in any menu", () => {
  assert.match(errors([add("/ppp profile", { name: "p", "on-up": ":log info x" })])[0], /script/);
  assert.match(errors([add("/interface pppoe-client", { name: "isp", password: "Hunter2" })])[0], /secret/);
  assert.match(errors([add("/interface wireguard peers", { interface: "wg1", "preshared-key": "abc=" })])[0], /secret/);
  assert.equal(validateProposal({ commands: [add("/interface wireguard peers", { interface: "wg1", "public-key": PLACEHOLDERS.publicKey, "preshared-key": PLACEHOLDERS.presharedKey })] }).ok, true);
});

test("a placeholder is allowed only in the field it belongs to", () => {
  assert.match(errors([add("/ip firewall address-list", { list: "a", address: "10.0.0.1", comment: PLACEHOLDERS.publicKey })])[0], /placeholder/);
  assert.match(errors([add("/interface wireguard peers", { interface: "wg1", "public-key": "{{anything.else}}" })])[0], /placeholder/);
});

test("shape: action, where, names, values, count", () => {
  assert.match(errors([{ path: "/ip address", action: "print", params: {} }])[0], /action/);
  assert.match(errors([{ path: "/ip address", action: "set", params: { disabled: "yes" } }])[0], /where/);
  assert.match(errors([{ path: "/ip address", action: "add", where: { a: "b" }, params: { address: "10.0.0.1/24" } }])[0], /where/);
  assert.match(errors([add("/ip address", { "bad name": "x" })])[0], /field name/);
  assert.match(errors([add("/ip address", { address: "10.0.0.1/24\n/user add" })])[0], /value/);
  assert.match(errors([add("/ip address", { address: "x".repeat(501) })])[0], /value/);
  assert.match(errors([{ path: "/ip address", action: "remove", where: { address: "10.0.0.1/24" }, params: { comment: "x" } }])[0], /params/);
  assert.match(errors([])[0], /at least one/);
  assert.match(errors(Array.from({ length: 31 }, () => add("/ip dns static", { name: "a", address: "10.0.0.1" })))[0], /30/);
});

test("risk: commands that can cut the device off are flagged, not refused", () => {
  const risky = [
    add("/ip address", { address: "10.0.0.1/24", interface: "ether1" }),
    add("/ip route", { "dst-address": "0.0.0.0/0", gateway: "10.0.0.254" }),
    add("/ip firewall filter", { chain: "input", action: "drop" }),
    { path: "/interface", action: "disable", where: { name: "ether1" } },
    add("/ip firewall nat", { chain: "dstnat", action: "dst-nat" }),
  ];
  for (const command of risky) {
    const result = validateProposal({ commands: [command] });
    assert.equal(result.ok, true, command.path);
    assert.equal(result.risk, "high", command.path);
    assert.ok(result.commands[0].riskReason);
  }
  assert.equal(validateProposal({ commands: [add("/ip firewall filter", { chain: "forward", action: "accept" })] }).risk, "normal");
  assert.equal(validateProposal({ commands: [add("/interface wireguard peers", { interface: "wg1", "public-key": PLACEHOLDERS.publicKey })] }).risk, "normal");
});

// --- дополнительные проверки поверх брифа ---

test("every denied path from the spec is refused, with and without a sub-menu", () => {
  const spec = ["/ip ipsec key", "/tr069-client", "/ip socks", "/ip proxy", "/ip cloud", "/disk", "/user", "/system", "/file", "/tool", "/import", "/export", "/certificate", "/ip service", "/ip ssh", "/ppp secret", "/ip hotspot user", "/user-manager", "/container", "/snmp community", "/radius", "/password", "/console", "/port", "/special-login",
    // финальная волна: решение контролёра
    "/ip tftp", "/ip smb", "/app", "/partitions", "/zerotier"];
  assert.deepEqual([...DENIED_PATHS].sort(), [...spec].sort());
  for (const path of spec) {
    assert.match(errors([add(path, { name: "x" })])[0], /not allowed/, path);
    assert.match(errors([add(`${path} sub`, { name: "x" })])[0], /not allowed/, `${path} sub`);
  }
});

test("a path that merely shares a string prefix with a denied entry is not denied", () => {
  for (const path of ["/username-thing", "/ip services-foo", "/ip ssh-keys", "/portal", "/files", "/ppp secrets", "/ip hotspot users", "/ip hotspot"]) {
    assert.doesNotMatch((errors([add(path, { name: "x" })])[0] || ""), /not allowed/, path);
  }
  assert.equal(validateProposal({ commands: [add("/ppp profile", { name: "x" })] }).ok, true);
});

test("path is normalized in the result", () => {
  const result = validateProposal({ commands: [add("ip//firewall   address-list/", { list: "a" })] });
  assert.equal(result.ok, true);
  assert.equal(result.commands[0].path, "/ip firewall address-list");
  assert.equal(result.commands[0].where, null);
  assert.equal(result.commands[0].risk, "normal");
  assert.equal(result.commands[0].riskReason, null);
});

test("bad paths and non-object input are refused", () => {
  assert.equal(validateProposal(null).ok, false);
  assert.equal(validateProposal({}).ok, false);
  assert.equal(validateProposal({ commands: "x" }).ok, false);
  assert.equal(errors([add("/", { a: "b" })]).length, 1);
  assert.equal(errors([add(5, { a: "b" })]).length, 1);
  assert.equal(errors([add("/ip address; /user", { a: "b" })]).length, 1);
  assert.equal(errors(["x"]).length, 1);
  assert.match(errors([add("/ip address; /user", { a: "b" })])[0], /invalid path/);
  assert.match(errors([add("/ip firewall..user", { a: "b" })])[0], /invalid path/);
  assert.match(errors([add("/a/b/c/d/e/f/g", { a: "b" })])[0], /invalid path/);
});

test("values must be strings", () => {
  for (const value of [5, true, null, ["a"], { a: "b" }, undefined]) {
    assert.match(errors([add("/ip address", { address: value })])[0], /value/);
  }
});

test("where: 1-5 string pairs, same name and value rules", () => {
  const set = (where, params = { disabled: "yes" }) => ({ path: "/ip dns static", action: "set", where, params });
  assert.equal(validateProposal({ commands: [set({ name: "a" })] }).ok, true);
  assert.match(errors([set({})])[0], /where/);
  assert.match(errors([set({ n1: "1", n2: "2", n3: "3", n4: "4", n5: "5", n6: "6" })])[0], /where/);
  assert.equal(validateProposal({ commands: [set({ n1: "1", n2: "2", n3: "3", n4: "4", n5: "5" })] }).ok, true);
  assert.match(errors([set(["a"])])[0], /where/);
  assert.match(errors([set({ name: 5 })])[0], /value/);
  assert.match(errors([set({ "Bad Name": "x" })])[0], /field name/);
  assert.match(errors([set({ name: "a\nb" })])[0], /value/);
  assert.match(errors([set({ password: "x" })])[0], /secret/);
  assert.match(errors([set({ "on-up": "x" })])[0], /script/);
});

test("params: add/set need 1-40 pairs, remove/enable/disable none", () => {
  const many = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`f${i}`, "v"]));
  assert.equal(validateProposal({ commands: [add("/ip dns static", many(40))] }).ok, true);
  assert.match(errors([add("/ip dns static", many(41))])[0], /params/);
  assert.match(errors([add("/ip dns static", {})])[0], /params/);
  assert.match(errors([{ path: "/ip dns static", action: "set", where: { name: "a" } }])[0], /params/);
  for (const action of ["enable", "disable"]) {
    assert.match(errors([{ path: "/ip dns static", action, where: { name: "a" }, params: { x: "y" } }])[0], /params/);
    assert.equal(validateProposal({ commands: [{ path: "/ip dns static", action, where: { name: "a" } }] }).ok, true);
  }
});

test("MAX_COMMANDS commands are accepted", () => {
  assert.equal(MAX_COMMANDS, 30);
  assert.equal(validateProposal({ commands: Array.from({ length: 30 }, () => add("/ip dns static", { name: "a" })) }).ok, true);
});

test("a placeholder cannot be smuggled inside a longer value or the wrong field", () => {
  assert.match(errors([add("/interface wireguard peers", { interface: "wg1", "public-key": PLACEHOLDERS.presharedKey })])[0], /placeholder/);
  assert.match(errors([add("/interface wireguard peers", { interface: "wg1", "preshared-key": PLACEHOLDERS.publicKey })])[0], /placeholder/);
  assert.match(errors([add("/interface wireguard peers", { interface: "wg1", "public-key": `x${PLACEHOLDERS.publicKey}` })])[0], /placeholder/);
  assert.match(errors([add("/ip address", { comment: `a ${PLACEHOLDERS.publicKey}` })])[0], /placeholder/);
});

test("public-key is not a secret; placeholders are collected once each", () => {
  const result = validateProposal({
    commands: [
      add("/interface wireguard peers", { interface: "wg1", "public-key": PLACEHOLDERS.publicKey }),
      add("/interface wireguard peers", { interface: "wg2", "public-key": PLACEHOLDERS.publicKey, "preshared-key": PLACEHOLDERS.presharedKey }),
    ],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.placeholders, [PLACEHOLDERS.publicKey, PLACEHOLDERS.presharedKey]);
  assert.equal(validateProposal({ commands: [add("/interface wireguard peers", { interface: "wg1", "public-key": "AbCd=" })] }).ok, true);
});

test("errors carry the command number and are all collected", () => {
  const list = errors([add("/ip address", { address: "1.1.1.1/32" }), add("/user", { name: "x" }), add("/file", { name: "y" })]);
  assert.equal(list.length, 2);
  assert.match(list[0], /^command 2: \/user is not allowed/);
  assert.match(list[1], /^command 3: /);
});

test("risk: every risky menu from the spec, and only the right actions on /interface", () => {
  for (const path of ["/ip address", "/ip route", "/ip firewall nat", "/interface bridge", "/interface bridge port", "/interface vlan", "/routing ospf", "/ip dhcp-client", "/interface list", "/interface list member"]) {
    assert.equal(validateProposal({ commands: [add(path, { mtu: "1400" })] }).risk, "high", path);
  }
  assert.equal(validateProposal({ commands: [add("/ip firewall raw", { chain: "input" })] }).risk, "high");
  assert.equal(validateProposal({ commands: [add("/ip firewall raw", { chain: "prerouting" })] }).risk, "normal");
  for (const action of ["set", "remove", "disable"]) {
    assert.equal(validateProposal({ commands: [{ path: "/interface", action, where: { name: "e" }, params: action === "set" ? { mtu: "1400" } : undefined }] }).risk, "high", action);
  }
  assert.equal(validateProposal({ commands: [{ path: "/interface", action: "enable", where: { name: "e" } }] }).risk, "normal");
  assert.equal(validateProposal({ commands: [add("/interface wireguard", { name: "wg9" })] }).risk, "normal");
  // один рискованный на пакет — весь запрос высокий
  const mixed = validateProposal({ commands: [add("/ip dns static", { name: "a" }), add("/ip address", { address: "1.1.1.1/32" })] });
  assert.equal(mixed.risk, "high");
  assert.equal(mixed.commands[0].risk, "normal");
  assert.equal(mixed.commands[1].risk, "high");
});

// --- fix round 1: сокращения RouterOS ---

test("abbreviated menu words cannot bypass the denied list", () => {
  for (const entry of DENIED_PATHS) {
    const words = entry.split(" ").map((w) => w.replace(/^\//, ""));
    for (const n of [2, 1]) {
      const path = `/${words.map((w) => w.slice(0, n)).join(" ")}`;
      assert.match(errors([add(path, { name: "x" })])[0], /not allowed/, path);
    }
  }
  for (const path of ["/us", "/u", "/ip ser", "/sys scr", "/sys sched", "/fi", "/ip ssh x"]) {
    assert.match(errors([add(path, { name: "x" })])[0], /not allowed/, path);
  }
  assert.doesNotMatch(errors([add("/ip", { a: "b" })])[0] || "", /not allowed/);
  assert.doesNotMatch(errors([add("/ip services-foo", { a: "b" })])[0] || "", /not allowed/);
  assert.doesNotMatch(errors([add("/username-thing", { a: "b" })])[0] || "", /not allowed/);
});

test("abbreviated script field names are refused, in params and where", () => {
  for (const name of ["lease-s", "scr", "sou", "on", "o", "on-x", "up-s", "test-sc", "source", "script"]) {
    assert.match(errors([add("/ip dhcp-server", { [name]: "x" })])[0], /script/, name);
    assert.match(errors([{ path: "/ip dns static", action: "set", where: { [name]: "x" }, params: { a: "b" } }])[0], /script/, name);
  }
});

test("abbreviated secret field names are refused; public fields are not", () => {
  for (const name of ["private-k", "preshared-k", "pas", "p", "pa", "k", "key", "wpa2-pre", "comm", "tok", "pin", "pin-n"]) {
    assert.match(errors([add("/interface wireguard", { [name]: "AAAA=" })])[0], /secret/, name);
  }
  assert.match(errors([add("/interface wireguard peers", { interface: "w", "public-key": "AbCd=", "preshared-k": PLACEHOLDERS.presharedKey })])[0], /placeholder/);
  assert.equal(validateProposal({ commands: [add("/ip dns static", { name: "abc", "public-key": "x", "key-size": "2048" })] }).ok, true);
});

test("firewall filter/raw risk: add by chain; other actions high unless where.chain is not input", () => {
  const risk = (command) => validateProposal({ commands: [command] }).risk;
  assert.equal(risk({ path: "/ip firewall filter", action: "set", where: { comment: "a" }, params: { disabled: "yes" } }), "high");
  assert.equal(risk({ path: "/ip firewall filter", action: "remove", where: { chain: "input" } }), "high");
  assert.equal(risk({ path: "/ip firewall filter", action: "remove", where: { chain: "forward" } }), "normal");
  assert.equal(risk({ path: "/ip firewall raw", action: "disable", where: { chain: "prerouting" } }), "normal");
  assert.equal(risk({ path: "/ip firewall filter", action: "set", where: { chain: "forward" }, params: { chain: "input" } }), "high");
  assert.equal(risk({ path: "/ip firewall filter", action: "enable", where: { name: "x" } }), "high");
});

test("abbreviated paths are risk-marked", () => {
  assert.equal(validateProposal({ commands: [add("/ip addr", { address: "10.0.0.1/24" })] }).risk, "high");
  assert.equal(validateProposal({ commands: [add("/ip fire nat", { chain: "srcnat" })] }).risk, "high");
  assert.equal(validateProposal({ commands: [{ path: "/inter", action: "disable", where: { name: "e" } }] }).risk, "high");
});

test("validated command holds copies of params and where", () => {
  const params = { comment: "a" };
  const where = { name: "x" };
  const result = validateProposal({ commands: [{ path: "/ip dns static", action: "set", where, params }] });
  result.commands[0].params.comment = "changed";
  result.commands[0].where.name = "changed";
  assert.equal(params.comment, "a");
  assert.equal(where.name, "x");
});

// --- fix round 2 ---

test("exact real field names that prefix a secret name are accepted; their abbreviations are not", () => {
  for (const name of ["user", "auth", "authentication", "group", "encryption", "http-proxy", "tls"]) {
    assert.equal(validateProposal({ commands: [add("/interface pppoe-client", { name: "isp", interface: "ether1", [name]: "x" })] }).ok, true, name);
  }
  for (const name of ["us", "authent", "grou", "encrypt", "tl"]) {
    assert.match(errors([add("/interface pppoe-client", { name: "isp", [name]: "x" })])[0], /secret/, name);
  }
});

test("more secret names are covered by prefix", () => {
  for (const name of ["private-p", "private-pre-shared-key", "private-passphrase", "sim-p", "tcp-md5-k", "xauth-p", "management-protection-k"]) {
    assert.match(errors([add("/interface wireguard", { [name]: "AAAA=" })])[0], /secret/, name);
  }
  assert.equal(validateProposal({ commands: [add("/ip dns static", { name: "abc", "xauth-login": "bob", identity: "x" })] }).ok, true);
});

test("firewall chain is read from abbreviated field names and tolerant values", () => {
  const risk = (command) => validateProposal({ commands: [command] }).risk;
  const f = "/ip firewall filter";
  assert.equal(risk(add(f, { chai: "input" })), "high");
  assert.equal(risk(add(f, { ch: " INPUT " })), "high");
  assert.equal(risk({ path: f, action: "set", where: { comment: "x" }, params: { ch: "input" } }), "high");
  assert.equal(risk({ path: f, action: "set", where: { comment: "x" }, params: { chain: "!forward" } }), "high");
  assert.equal(risk({ path: f, action: "remove", where: { ch: "forward" } }), "normal");
  assert.equal(risk({ path: f, action: "remove", where: { chain: " Forward " } }), "normal");
  assert.equal(risk({ path: f, action: "remove", where: { chain: "!input" } }), "high");
  assert.equal(risk({ path: f, action: "remove", where: { chain: "!forward" } }), "high");
  assert.equal(risk({ path: f, action: "remove", where: { name: "x" } }), "high");
  assert.equal(risk(add(f, { chain: "forward" })), "normal");
});

test("ipsec key is denied; ipv6 risk twins", () => {
  assert.match(errors([add("/ip ipsec key", { name: "x" })])[0], /not allowed/);
  assert.equal(validateProposal({ commands: [add("/ip ipsec peer", { name: "abc" })] }).ok, true);
  for (const path of ["/ipv6 address", "/ipv6 route"]) {
    assert.equal(validateProposal({ commands: [add(path, { mtu: "1400" })] }).risk, "high", path);
  }
  for (const path of ["/ipv6 firewall filter", "/ipv6 firewall raw"]) {
    assert.equal(validateProposal({ commands: [add(path, { chain: "input" })] }).risk, "high", path);
    assert.equal(validateProposal({ commands: [add(path, { chain: "forward" })] }).risk, "normal", path);
    assert.equal(validateProposal({ commands: [{ path, action: "remove", where: { comment: "x" } }] }).risk, "high", path);
  }
});

// --- финальная волна

test("the five menus added by the controller ruling are denied, with sub-menus and abbreviations", () => {
  for (const path of ["/ip tftp", "/ip smb", "/ip smb shares", "/app", "/app settings", "/partitions", "/zerotier", "/zerotier interface", "/zero", "/part", "/ip tf"]) {
    assert.match(errors([add(path, { name: "x" })])[0], /not allowed/, path);
  }
  assert.equal(validateProposal({ commands: [add("/ip traffic-flow", { enabled: "yes" })] }).ok, true);
});

test("a field name is at most 64 characters, in where and in params", () => {
  const ok64 = "a".repeat(64);
  const bad65 = "a".repeat(65);
  assert.equal(validateProposal({ commands: [add("/ip dns static", { [ok64]: "x" })] }).ok, true);
  const inParams = errors([add("/ip dns static", { [bad65]: "x" })]);
  assert.match(inParams[0], /^command 1: field name is too long \(at most 64 characters\)$/);
  assert.ok(!inParams[0].includes(bad65), "the long name is not echoed");
  const inWhere = errors([{ path: "/ip dns static", action: "remove", where: { [bad65]: "x" } }]);
  assert.match(inWhere[0], /^command 1: where: field name is too long \(at most 64 characters\)$/);
});

test("minors: only plain objects are accepted as a command, where and params", () => {
  const bad = (command) => validateProposal({ commands: [command] });
  assert.equal(bad(new Date()).ok, false);
  assert.equal(bad({ path: "/ip dns static", action: "add", params: new Map([["name", "a"]]) }).ok, false);
  assert.equal(bad({ path: "/ip dns static", action: "set", where: new Date(), params: { name: "a" } }).ok, false);
  assert.equal(bad({ path: "/ip dns static", action: "add", params: Object.assign(Object.create(null), { name: "a", address: "10.0.0.1" }) }).ok, true);
  assert.throws(() => DENIED_PATHS.push("/x"));
});
