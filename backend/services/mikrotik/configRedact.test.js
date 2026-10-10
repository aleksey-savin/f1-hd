// node --test services/mikrotik/configRedact.test.js
const test = require("node:test");
const assert = require("node:assert/strict");

const { redactConfig, looksLikeExport, SECRET, HIDDEN } = require("./configRedact");

const flat = (config) => config.sections.map((s) => [s.path, ...s.lines].join("\n")).join("\n");
const redact = (text) => flat(redactConfig(text));

// Каждый класс секрета: значение не должно остаться в выводе ни в каком виде.
const LEAKS = [
  ["WireGuard private key", '/interface wireguard\nadd listen-port=13231 name=wg0 private-key="aPrivKeyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="', "aPrivKey"],
  ["WireGuard preshared key", '/interface wireguard peers\nadd interface=wg0 preshared-key="aPskBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=" public-key="pub="', "aPskBBB"],
  ["PPP secret password", "/ppp secret\nadd name=ivanov password=Qwerty123 profile=vpn service=l2tp remote-address=10.9.0.5", "Qwerty123"],
  ["PPP client password", "/interface l2tp-client\nadd connect-to=1.2.3.4 name=l2tp-out1 password=Zx9!pass user=office", "Zx9!pass"],
  ["IPsec secret", '/ip ipsec identity\nadd peer=hq secret="very secret psk"', "very secret psk"],
  ["L2TP server ipsec secret", "/interface l2tp-server server\nset enabled=yes ipsec-secret=Sup3rIpsec use-ipsec=yes", "Sup3rIpsec"],
  ["Wi-Fi v6 passphrase", '/interface wireless security-profiles\nadd name=home wpa2-pre-shared-key="wifi pass 1" wpa-pre-shared-key=oldwifi1', "wifi pass 1"],
  ["Wi-Fi v6 old passphrase", "/interface wireless security-profiles\nadd name=home wpa-pre-shared-key=oldwifi1", "oldwifi1"],
  ["Wi-Fi v7 passphrase", "/interface wifi security\nadd name=sec1 passphrase=N3wWifiPass authentication-types=wpa2-psk", "N3wWifiPass"],
  ["Wi-Fi v7 inline passphrase", "/interface wifi\nadd name=wifi1 security.authentication-types=wpa2-psk security.passphrase=Inl1nePass ssid=Office", "Inl1nePass"],
  ["CAPsMAN passphrase", "/caps-man security\nadd name=sec passphrase=CapsPass99", "CapsPass99"],
  ["SNMP community name", "/snmp community\nadd addresses=10.0.0.0/8 name=s3cretCommunity", "s3cretCommunity"],
  ["SNMP trap community", "/snmp\nset enabled=yes trap-community=trapCommunity1", "trapCommunity1"],
  ["SNMP v3 passwords", "/snmp community\nset [ find default=yes ] authentication-password=AuthPw1 encryption-password=EncPw2", "AuthPw1"],
  ["RADIUS secret", "/radius\nadd address=10.0.0.5 secret=RadiusShared service=ppp", "RadiusShared"],
  ["E-mail password", "/tool e-mail\nset from=router@example.ru password=MailPw77 server=smtp.example.ru user=router", "MailPw77"],
  ["User line", "/user\nadd address=10.0.0.0/24 group=full name=admin2 password=AdminPw!", "AdminPw!"],
  ["Hotspot user", "/ip hotspot user\nadd name=guest password=GuestPw1", "GuestPw1"],
  ["OSPF auth key", "/routing ospf interface-template\nadd area=backbone auth=md5 auth-key=OspfKey11 auth-id=1", "OspfKey11"],
  ["ZeroTier identity", '/zerotier\nset zt1 identity="aa11bb22cc:0:pubpart:privpart9999"', "privpart9999"],
  ["Container env", "/container envs\nadd key=DB_PASSWORD name=app value=ContainerPw", "ContainerPw"],
  ["SIM pin", "/interface lte\nset [ find default-name=lte1 ] pin=4321x", "4321x"],
  ["Script body", '/system script\nadd name=backup source=":local pw \\"ScriptPw55\\"\\r\\n/tool fetch url=\\"https://x/y\\\\?t=1\\""', "ScriptPw55"],
  ["Scheduler body", '/system scheduler\nadd interval=1d name=tg on-event="/tool fetch url=\\"https://api.telegram.org/bot123:AAtoken/send\\""', "AAtoken"],
  ["Netwatch script", '/tool netwatch\nadd host=8.8.8.8 down-script="/log info \\"NetPw99\\""', "NetPw99"],
  ["DHCP alert script", '/ip dhcp-server alert\nadd interface=bridge on-alert="/tool fetch url=\\"https://api.telegram.org/bot123456:AAHtokenvalue/send\\""', "AAHtokenvalue"],
  ["MQTT handler script", '/iot mqtt subscribe\nadd broker=b1 on-message=":global pw \\"S3cretMqtt\\""', "S3cretMqtt"],
  ["MACsec key", "/interface macsec\nadd cak=0123456789abcdef0123456789abcdef ckn=aa11 interface=ether1", "0123456789abcdef0123456789abcdef"],
  ["LCD pin", "/lcd pin\nset pin-number=43215", "43215"],
  ["Password inside a URL", "/tr069-client\nset acs-url=https://acsuser:AcsPass99@acs.example.ru:7547/ enabled=yes", "AcsPass99"],
  ["Password inside a quoted URL", '/tool fetch\nadd url="ftp://backup:FtpPass77@10.0.0.9/cfg"', "FtpPass77"],
  ["Unknown *key* field", "/some new feature\nadd name=x shiny-api-key=Fresh0Secret", "Fresh0Secret"],
  ["Token in a comment", '/ip address\nadd address=10.0.0.1/24 comment="password: Hunter2Hunter2" interface=bridge', "Hunter2Hunter2"],
];

for (const [title, input, secret] of LEAKS) {
  test(`hides: ${title}`, () => {
    const out = redact(input);
    assert.ok(!out.includes(secret), `leaked in: ${out}`);
  });
}

test("a secret split across continuation lines is still hidden", () => {
  const out = redact('/interface wireguard\nadd name=wg0 private-key="firstHalfOfTheKey\\\n    SecondHalfOfTheKey="');
  assert.ok(!out.includes("firstHalf") && !out.includes("SecondHalf"), out);
  assert.match(out, /private-key=\[секрет скрыт\]/);
});

test("the structure around a hidden value survives", () => {
  const out = redact('/interface wireguard peers\nadd allowed-address=10.8.0.2/32 endpoint-address=203.0.113.7 interface=wg0 preshared-key="p=" public-key="PubKeyStays="');
  assert.equal(
    out,
    `/interface wireguard peers\nadd allowed-address=10.8.0.2/32 endpoint-address=203.0.113.7 interface=wg0 preshared-key=${SECRET} public-key="PubKeyStays="`,
  );
});

test("public look-alikes are not hidden", () => {
  const out = redact("/ip firewall mangle\nadd action=mark-routing chain=prerouting passthrough=yes\n/routing ospf interface\nadd interface=ether1 passive=yes");
  assert.match(out, /passthrough=yes/);
  assert.match(out, /passive=yes/);
});

test("account sections keep names only; SNMP community keeps not even the name", () => {
  const out = redact("/user\nadd address=10.0.0.0/24 comment=boss group=full name=admin2\n/snmp community\nadd addresses=10.0.0.0/8 comment=nms name=zzz");
  assert.match(out, new RegExp(`add address=${HIDDEN.replace(/[[\]]/g, "\\$&")} comment=boss group=full name=admin2`));
  assert.match(out, /add addresses=\[скрыто\] comment=nms name=\[скрыто\]/);
});

test("/user group is not an account section", () => {
  assert.match(redact("/user group\nadd name=hd policy=api,read,test,ssh"), /policy=api,read,test,ssh/);
});

test("script bodies become a stub with a line count", () => {
  const out = redact('/system script\nadd dont-require-permissions=no name=backup source="line1\\r\\nline2\\r\\nline3"');
  assert.match(out, /name=backup source="\[скрипт скрыт: 3 строк\]"/);
});

test("a line with an unclosed quote is hidden whole", () => {
  const config = redactConfig('/ip address\nadd address=10.0.0.1/24 comment="broken password=Leak1234');
  assert.deepEqual(config.sections[0].lines, ["[строка скрыта: не удалось разобрать]"]);
});

test("a quoted value may contain escaped quotes and spaces", () => {
  const out = redact('/ip firewall filter\nadd action=drop chain=input comment="drop \\"bad\\" hosts" src-address-list=bad');
  assert.match(out, /comment="drop \\"bad\\" hosts" src-address-list=bad/);
});

test("header, section order, merged repeats, one-line form and the hidden counter", () => {
  const config = redactConfig(
    [
      "# 2026-10-10 12:00:00 by RouterOS 7.15.3",
      "# model = RB4011iGS+",
      "/interface bridge",
      "add name=bridge",
      "/ip address add address=10.0.0.1/24 interface=bridge",
      "/interface bridge",
      "add name=bridge2",
      "/ppp secret",
      "add name=a password=b",
      "",
    ].join("\r\n"),
  );
  assert.deepEqual(config.header, ["# 2026-10-10 12:00:00 by RouterOS 7.15.3", "# model = RB4011iGS+"]);
  assert.deepEqual(config.sections.map((s) => s.path), ["/interface bridge", "/ip address", "/ppp secret"]);
  assert.deepEqual(config.sections[0].lines, ["add name=bridge", "add name=bridge2"]);
  assert.deepEqual(config.sections[1].lines, ["add address=10.0.0.1/24 interface=bridge"]);
  assert.equal(config.hidden, 1);
});

test("find-expressions in brackets are scanned too", () => {
  const out = redact("/interface wireless security-profiles\nset [ find default=yes ] supplicant-identity=MikroTik wpa2-pre-shared-key=InBrackets1");
  assert.ok(!out.includes("InBrackets1"));
  assert.match(out, /\[ find default=yes \]/);
});

test("looksLikeExport tells an export from a command error", () => {
  assert.equal(looksLikeExport("# 2026-10-10 by RouterOS 7\n/ip address"), true);
  assert.equal(looksLikeExport(Buffer.from("\r\n/interface bridge\r\n")), true);
  assert.equal(looksLikeExport("expected end of command (line 1 column 9)"), false);
  assert.equal(looksLikeExport(""), false);
});

test("a wrap that falls inside an escape sequence does not let the tail of a script out", () => {
  // Строка кончается на «\\» + перенос: слеш от «\n» и слеш переноса
  const raw = '/system scheduler\nadd name=tg on-event="/log info \\"a\\"\\r\\\\\n    n/tool fetch url=\\"https://x/?password=Hidden123\\"" start-time=startup\n/ip address\nadd address=10.0.0.1/24 interface=bridge';
  const config = redactConfig(raw);
  const out = flat(config);
  assert.ok(!out.includes("Hidden123"), out);
  assert.match(out, /start-time=startup/);
  assert.deepEqual(config.sections.map((s) => s.path), ["/system scheduler", "/ip address"]);
});

test("a quote that never closes hides everything after it", () => {
  const config = redactConfig('/system script\nadd name=x source="broken\n/ip address\nadd address=10.0.0.1/24 comment=password=Leak12345');
  assert.ok(!flat(config).includes("Leak12345"));
  assert.deepEqual(config.sections[0].lines, ["[строка скрыта: не удалось разобрать]"]);
});

test("a URL keeps its host when the credentials are cut out", () => {
  assert.match(redact("/tr069-client\nset acs-url=https://acsuser:AcsPass99@acs.example.ru:7547/"), /acs-url=https:\/\/\[скрыто\]@acs\.example\.ru:7547\//);
});
