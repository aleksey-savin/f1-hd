// Dependency-free credential field classification shared by scanners and redaction.
// Имена полей без «говорящей» подстроки, которые всё равно секрет.
const SECRET_FIELDS = new Set(["passcode", "cak"]);
// «pin» отдельным словом имени: pin, sim-pin, pin-number (но не ping, не spinning)
const PIN_NAME = /(^|[-.])pin([-.]|$)/;
const SECRET_NAME = /key|pass|secret|psk|token|community/;
// Публичное с «key»/«pass» в имени — показывается как есть.
const PUBLIC_FIELDS = new Set([
  "public-key",
  "key-size",
  "key-type",
  "key-usage",
  "key-id",
  "authentication-key-id",
  "host-key-size",
  "host-key-type",
  "group-key-update",
  "passthrough",
  "passive",
]);

// Секрет под обычным именем поля — только в своём разделе.
const SECTION_SECRET_FIELDS = [
  [/^\/zerotier/, new Set(["identity"])],
  [/^\/container envs/, new Set(["value"])],
];

const isSecretField = (section, name) => {
  if (PUBLIC_FIELDS.has(name)) return false;
  if (SECRET_FIELDS.has(name) || SECRET_NAME.test(name) || PIN_NAME.test(name)) return true;
  return SECTION_SECRET_FIELDS.some(([path, fields]) => path.test(section) && fields.has(name));
};

module.exports = { isSecretField, PUBLIC_FIELDS };
