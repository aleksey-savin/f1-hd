// Read-only probe for the firmware-upgrade commands (plan task 1). Connects
// with DIRECT parameters — no database, so it runs anywhere with network
// access to the device, whatever MIKROTIK_ENC_KEY the environment has.
//
//   MT_PASSWORD='…' node scripts/mikrotikUpgradeProbe.js \
//     --host 62.249.154.214 --port 8729 --user hd --knock 22046,29551,23786 [--ssh-port 22]
//
// Runs nothing that changes the device: package/update print, check-for-updates
// (asks upgrade.mikrotik.com for the latest version; no install), routerboard
// print, and the same package print over SSH to see the CLI text format.
require("module-alias/register");

const {
  withApiSession,
  withSshSession,
  sshExec,
} = require("../services/mikrotik/connector");

const arg = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
};

const params = {
  host: arg("host"),
  port: Number(arg("port") || 8729),
  user: arg("user"),
  password: process.env.MT_PASSWORD,
  knockSequence: (arg("knock") || "")
    .split(",")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0),
};

const main = async () => {
  if (!params.host || !params.user || !params.password) {
    console.error("usage: MT_PASSWORD=… node scripts/mikrotikUpgradeProbe.js --host H --user U [--port 8729] [--ssh-port 22] [--knock a,b,c]");
    process.exit(2);
  }
  const report = await withApiSession(
    params,
    async (run) => {
      const out = {};
      out.updateBefore = await run(["/system/package/update/print"]);
      out.check = await run(["/system/package/update/check-for-updates"]);
      out.updateAfter = await run(["/system/package/update/print"]);
      try {
        out.routerboard = await run(["/system/routerboard/print"]);
      } catch (error) {
        out.routerboardError = error.message;
      }
      out.resource = await run(["/system/resource/print"]);
      return out;
    },
    { deadlineMs: 90000 },
  );
  console.log(JSON.stringify(report, null, 2));

  const ssh = await withSshSession(
    { host: params.host, sshPort: Number(arg("ssh-port") || 22), user: params.user, password: params.password, knockSequence: params.knockSequence },
    (conn) => sshExec(conn, "/system package update print"),
  );
  console.log("--- SSH /system package update print ---");
  console.log(ssh.result.toString("utf8"));
};

main().catch((error) => {
  console.error("probe failed:", error.code || "", error.message);
  process.exit(1);
});
