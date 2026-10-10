// node --test services/mikrotik/changeRender.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { quoteValue, renderCommand, displayCommand, diffRows } = require("./changeRender");
const { hasForbiddenChars, apiWords } = require("./changeRender");

test("plain values stay bare, anything else is quoted and escaped", () => {
  assert.equal(quoteValue("10.0.55.20/32"), "10.0.55.20/32");
  assert.equal(quoteValue("i_petrov"), "i_petrov");
  assert.equal(quoteValue(""), '""');
  assert.equal(quoteValue("Ivan Petrov"), '"Ivan Petrov"');
  assert.equal(quoteValue('say "hi"'), '"say \\"hi\\""');
  assert.equal(quoteValue("a\\b"), '"a\\\\b"');
  assert.equal(quoteValue("$x"), '"\\$x"');
  assert.equal(quoteValue("a;b"), '"a;b"');
  assert.equal(quoteValue("[find]"), '"[find]"');
  assert.equal(quoteValue("what?"), '"what\\?"');
  assert.equal(quoteValue("kQ3v+a/b="), '"kQ3v+a/b="');
});

test("add, set and remove render as one RouterOS line", () => {
  assert.equal(
    renderCommand({ path: "/ip firewall address-list", action: "add", where: null, params: { list: "vpn-users", address: "10.0.55.20", comment: "Ivan Petrov" } }),
    '/ip firewall address-list add list=vpn-users address=10.0.55.20 comment="Ivan Petrov"',
  );
  assert.equal(
    renderCommand({ path: "/ip firewall address-list", action: "set", where: { list: "under_rsv", address: "10.0.20.116" }, params: { disabled: "yes" } }),
    '/ip firewall address-list set [find where list="under_rsv" address=10.0.20.116] disabled=yes',
  );
  assert.equal(
    renderCommand({ path: "/interface wireguard peers", action: "remove", where: { comment: "old; /user add" }, params: {} }),
    '/interface wireguard peers remove [find where comment="old; /user add"]',
  );
});

test("placeholders: real value when executing, a marker when shown to a person", () => {
  const command = { path: "/interface wireguard peers", action: "add", where: null, params: { interface: "wg1", "public-key": "{{wireguard.public-key}}" } };
  assert.equal(renderCommand(command, { values: { "{{wireguard.public-key}}": "kQ3v+a/b=" } }), '/interface wireguard peers add interface=wg1 public-key="kQ3v+a/b="');
  assert.throws(() => renderCommand(command), /placeholder/);
  assert.equal(displayCommand(command), "/interface wireguard peers add interface=wg1 public-key=‹создаст HD›");
});

test("diffRows lists only the fields a set changes", () => {
  const command = { path: "/ip firewall address-list", action: "set", where: { address: "10.0.20.116" }, params: { disabled: "yes", comment: "savin" } };
  assert.deepEqual(diffRows(command, { address: "10.0.20.116", disabled: "false", comment: "savin" }), [{ field: "disabled", from: "false", to: "yes" }]);
  assert.deepEqual(diffRows({ ...command, action: "remove" }, {}), []);
});

test("control characters and non-strings cannot be quoted", () => {
  for (const bad of ["a\nb", "a\rb", "a\tb", "a\u0000b", "a\u001bb", "a\u007fb"]) {
    assert.throws(() => quoteValue(bad), /forbidden/);
  }
  for (const bad of [5, null, undefined, true, {}, ["a"]]) {
    assert.throws(() => quoteValue(bad), /string/);
  }
});

test("where values are quoted by the same rule", () => {
  assert.equal(
    renderCommand({ path: "/ip firewall address-list", action: "disable", where: { comment: 'x" ; /user add' }, params: {} }),
    '/ip firewall address-list disable [find where comment="x\\" ; /user add"]',
  );
  assert.equal(
    renderCommand({ path: "/ip firewall address-list", action: "enable", where: { list: "a" }, params: {} }),
    '/ip firewall address-list enable [find where list="a"]',
  );
});

test("an injected value stays one value; unsafe names and paths are refused", () => {
  const line = renderCommand({ path: "/user", action: "add", where: null, params: { name: "x\" ; /system reset-configuration ; \"" } });
  assert.equal(line, '/user add name="x\\" ; /system reset-configuration ; \\""');
  assert.throws(() => renderCommand({ path: "/user", action: "add", where: null, params: { "a=b c": "x" } }), /field/);
  assert.throws(() => renderCommand({ path: "/user; /system reset", action: "add", where: null, params: {} }), /path/);
  assert.throws(() => renderCommand({ path: "/ip address", action: "set", where: null, params: { a: "b" } }), /where/);
  assert.throws(() => renderCommand({ path: "/ip address", action: "explode", where: null, params: {} }), /action/);
});

test("placeholder in a where or an unknown placeholder is unresolved", () => {
  const command = { path: "/x", action: "remove", where: { "public-key": "{{wireguard.public-key}}" }, params: {} };
  assert.throws(() => renderCommand(command), /placeholder/);
  assert.throws(() => renderCommand({ path: "/x", action: "add", where: null, params: { a: "{{other}}" } }, { values: {} }), /placeholder/);
  assert.equal(renderCommand(command, { values: { "{{wireguard.public-key}}": "k=" } }), '/x remove [find where public-key="k="]');
});

test("displayCommand shows the marker for both placeholders and does not throw on them", () => {
  const command = { path: "/interface wireguard peers", action: "add", where: null, params: { "public-key": "{{wireguard.public-key}}", "preshared-key": "{{wireguard.preshared-key}}" } };
  assert.equal(displayCommand(command), "/interface wireguard peers add public-key=‹создаст HD› preshared-key=‹создаст HD›");
});

test("diffRows treats true/false as yes/no both ways and reports absent fields", () => {
  const base = { path: "/p", action: "set", where: { a: "1" } };
  assert.deepEqual(diffRows({ ...base, params: { disabled: "no" } }, { disabled: "false" }), []);
  assert.deepEqual(diffRows({ ...base, params: { disabled: "yes" } }, { disabled: "true" }), []);
  assert.deepEqual(diffRows({ ...base, params: { disabled: "false" } }, { disabled: "no" }), []);
  assert.deepEqual(diffRows({ ...base, params: { disabled: "true" } }, { disabled: "no" }), [{ field: "disabled", from: "no", to: "true" }]);
  assert.deepEqual(diffRows({ ...base, params: { comment: "x" } }, {}), [{ field: "comment", from: "", to: "x" }]);
});

test("displayCommand throws on input that could not have passed validation", () => {
  const ok = { path: "/p", action: "add", where: null, params: { a: "b" } };
  assert.throws(() => displayCommand({ ...ok, params: { a: 5 } }), /string/);
  assert.throws(() => displayCommand({ ...ok, params: { a: "x\ny" } }), /forbidden/);
  assert.throws(() => displayCommand({ ...ok, path: "/p; x" }), /path/);
  assert.throws(() => displayCommand({ ...ok, params: { "a b": "x" } }), /field/);
  assert.throws(() => displayCommand({ ...ok, action: "set", where: {} }), /where/);
});

test("where keeps bare only strict literals", () => {
  const w = (where) => renderCommand({ path: "/p", action: "remove", where, params: {} });
  assert.equal(w({ comment: "list" }), '/p remove [find where comment="list"]');
  assert.equal(w({ a: "10.0.0.1", b: "10.0.0.0/24", c: "42", d: "yes", e: "no", f: "true", g: "false" }),
    "/p remove [find where a=10.0.0.1 b=10.0.0.0/24 c=42 d=yes e=no f=true g=false]");
  assert.equal(w({ a: "1.2.3" }), '/p remove [find where a="1.2.3"]');
  assert.equal(w({ a: "" }), '/p remove [find where a=""]');
  assert.equal(displayCommand({ path: "/p", action: "remove", where: { comment: "list" }, params: {} }), '/p remove [find where comment="list"]');
});

test("forbidden characters: C1, bidi, zero-width, separators, BOM; Cyrillic is fine", () => {
  const bad = ["\u0080", "\u009f", "\u202a", "\u202e", "\u2066", "\u2069", "\u200b", "\u200f", "\u2028", "\u2029", "\ufeff", "\n", "\u007f", "\u0000"];
  for (const ch of bad) {
    assert.equal(hasForbiddenChars(`a${ch}b`), true, JSON.stringify(ch));
    assert.throws(() => quoteValue(`a${ch}b`));
  }
  assert.equal(hasForbiddenChars("Иван Петров"), false);
  assert.equal(hasForbiddenChars("plain"), false);
  assert.equal(quoteValue("Иван Петров"), '"Иван Петров"');
  assert.equal(renderCommand({ path: "/p", action: "add", where: null, params: { comment: "Иван" } }), '/p add comment="Иван"');
});

test("a literal equal to the marker text is refused", () => {
  const c = { path: "/p", action: "add", where: null, params: { comment: "‹создаст HD›" } };
  assert.throws(() => displayCommand(c), /marker/);
  assert.throws(() => renderCommand(c), /marker/);
  assert.throws(() => displayCommand({ path: "/p", action: "remove", where: { a: "‹создаст HD›" }, params: {} }), /marker/);
});

test("apiWords: one sentence per action", () => {
  assert.deepEqual(
    apiWords({ path: "/ip firewall address-list", action: "add", where: null, params: { list: "vpn-users", comment: "a=b c" } }),
    ["/ip/firewall/address-list/add", "=list=vpn-users", "=comment=a=b c"],
  );
  assert.deepEqual(
    apiWords({ path: "/ip firewall address-list", action: "set", where: { address: "1.1.1.1" }, params: { disabled: "yes", comment: "x" } }, { id: "*1A" }),
    ["/ip/firewall/address-list/set", "=.id=*1A", "=disabled=yes", "=comment=x"],
  );
  for (const action of ["remove", "enable", "disable"]) {
    assert.deepEqual(apiWords({ path: "/ip address", action, where: { a: "1" }, params: {} }, { id: "*FF" }), [`/ip/address/${action}`, "=.id=*FF"]);
  }
});

test("apiWords: id rules", () => {
  const set = { path: "/p", action: "set", where: { a: "1" }, params: { b: "c" } };
  assert.throws(() => apiWords(set), /id/);
  for (const id of ["1A", "*", "*G1", "*1 ", "*1\n", 5]) assert.throws(() => apiWords(set, { id }), /id/);
  assert.throws(() => apiWords({ path: "/p", action: "add", where: null, params: {} }, { id: "*1" }), /id/);
});

test("apiWords: placeholders and unsafe values", () => {
  const c = { path: "/interface wireguard peers", action: "add", where: null, params: { "public-key": "{{wireguard.public-key}}" } };
  assert.deepEqual(apiWords(c, { values: { "{{wireguard.public-key}}": "kQ3v+a/b=" } }), ["/interface/wireguard/peers/add", "=public-key=kQ3v+a/b="]);
  assert.throws(() => apiWords(c), /placeholder/);
  const add = (v) => ({ path: "/p", action: "add", where: null, params: { a: v } });
  assert.throws(() => apiWords(add("x\ny")));
  assert.throws(() => apiWords(add("x\u202ey")));
  assert.throws(() => apiWords(add(5)), /string/);
  assert.throws(() => apiWords({ path: "/p;x", action: "add", where: null, params: {} }), /path/);
});

test("field names: lowercase, no leading dot or dash; .id/.proplist/.tag refused everywhere", () => {
  for (const name of [".id", ".proplist", ".tag", "-x", "Name", "a=b", "?x", "a_b", ""]) {
    for (const where of [null, { a: "1" }]) {
      assert.throws(() => apiWords({ path: "/p", action: "add", where: null, params: { [name]: "x" } }), /field/, name);
      assert.throws(() => renderCommand({ path: "/p", action: "add", where: null, params: { [name]: "x" } }), /field/, name);
      assert.throws(() => displayCommand({ path: "/p", action: "add", where: null, params: { [name]: "x" } }), /field/, name);
      void where;
    }
    assert.throws(() => renderCommand({ path: "/p", action: "remove", where: { [name]: "x" }, params: {} }), /field/, name);
    assert.throws(() => displayCommand({ path: "/p", action: "remove", where: { [name]: "x" }, params: {} }), /field/, name);
    assert.throws(() => apiWords({ path: "/p", action: "set", where: { a: "1" }, params: { [name]: "x" } }, { id: "*1" }), /field/, name);
  }
  assert.doesNotThrow(() => apiWords({ path: "/p", action: "add", where: null, params: { "public-key": "x", a1: "y", "a.b": "z" } }));
});

test("apiWords: set with no params throws", () => {
  assert.throws(() => apiWords({ path: "/p", action: "set", where: { a: "1" }, params: {} }, { id: "*1" }), /params/);
});

test("forbidden characters: U+061C and U+2060-2064", () => {
  for (const ch of ["؜", "⁠", "⁢", "⁤"]) {
    assert.equal(hasForbiddenChars(`a${ch}b`), true, JSON.stringify(ch));
    assert.throws(() => quoteValue(`a${ch}b`));
  }
  assert.equal(hasForbiddenChars("⁥a"), false);
});

test("minors: diffRows does not read the prototype; trailing backslash and specials stay one value", () => {
  const command = { path: "/ip dns static", action: "set", where: { name: "a" }, params: { comment: "constructor", ttl: "toString" } };
  assert.deepEqual(diffRows(command, { name: "a", comment: "constructor", ttl: "toString" }), []);
  assert.deepEqual(diffRows(command, { name: "a", comment: "x", ttl: "toString" }), [{ field: "comment", from: "x", to: "constructor" }]);
  assert.equal(quoteValue("a\\"), '"a\\\\"');
  assert.equal(quoteValue('"'), '"\\""');
  assert.equal(quoteValue("$?"), '"\\$\\?"');
});
