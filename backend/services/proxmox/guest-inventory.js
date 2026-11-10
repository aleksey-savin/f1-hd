// These commands are owned by HD. No request/VM strings are interpolated into them.
// They read package metadata or search Windows Update; they never install updates.
const LINUX_SCRIPT = `set -eu
export LC_ALL=C
printf 'HD_GUEST_INVENTORY_V1\\n'
dpkg-query -W -f='\${db:Status-Status}\\t\${binary:Package}\\t\${Version}\\t\${source:Package}\\t\${source:Version}\\n'
`;
const WINDOWS_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$job = Start-Job -ScriptBlock {
  $ErrorActionPreference = 'Stop'
  try {
  $os = Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion'
  $session = New-Object -ComObject Microsoft.Update.Session
  $session.ClientApplicationID = 'HD guest security inventory'
  $searcher = $session.CreateUpdateSearcher()
  $searcher.Online = $true
  $result = $searcher.Search("IsInstalled=0 and Type='Software'")
  if ([int]$result.ResultCode -ne 2) { throw 'Windows Update returned incomplete results' }
  $updates = @()
  foreach ($update in $result.Updates) {
    $cves = @($update.CveIDs | ForEach-Object { [string]$_ })
    $updates += @{
      id = [string]$update.Identity.UpdateID
      title = [string]$update.Title
      kb = @($update.KBArticleIDs | ForEach-Object { [string]$_ })
      cves = $cves
      severity = [string]$update.MsrcSeverity
      security = [bool]($update.MsrcSeverity -or $cves.Count -gt 0 -or @($update.Categories | Where-Object { $_.CategoryID -eq '0fa1201d-4330-4fa8-8ae9-b877473b6441' }).Count -gt 0)
    }
  }
  @{ schema = 1; build = "$($os.CurrentBuildNumber).$($os.UBR)"; installationType = [string]$os.InstallationType; rebootRequired = [bool](New-Object -ComObject Microsoft.Update.SystemInfo).RebootRequired; resultCode = [int]$result.ResultCode; updates = $updates } | ConvertTo-Json -Depth 8 -Compress
  } catch {
    @{ schema = 1; errorCode = ('{0:X8}' -f ($_.Exception.HResult -band 0xffffffffL)) } | ConvertTo-Json -Compress
  }
}
try {
  if (-not (Wait-Job $job -Timeout 180)) { throw 'Windows Update search timed out' }
  if ($job.State -ne 'Completed') { throw 'Windows Update search failed' }
  $data = Receive-Job $job -ErrorAction Stop
  [Console]::WriteLine([string]$data)
} catch {
  [Console]::Error.WriteLine('HD could not complete Windows Update search')
  exit 1
} finally {
  Stop-Job $job -ErrorAction SilentlyContinue
  Remove-Job $job -Force -ErrorAction SilentlyContinue
}
`;
const collectorFor = (os) => {
  if (["debian", "ubuntu"].includes(os.id))
    return ["/bin/sh", "-c", LINUX_SCRIPT];
  if (os.id === "mswindows")
    return [
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(WINDOWS_SCRIPT, "utf16le").toString("base64"),
    ];
  return null;
};
const text = (value, max = 300) =>
  typeof value === "string" &&
  value.length <= max &&
  [...value].every((character) => character.charCodeAt(0) >= 32);
const parseInventory = (rawOs, output) => {
  if (typeof output !== "string" || Buffer.byteLength(output) > 2 * 1024 * 1024)
    throw new Error("Слишком большой ответ сборщика гостевой ОС");
  const os = {
    id: rawOs.id,
    version: rawOs["version-id"] || "",
    name: rawOs["pretty-name"] || rawOs.name || rawOs.id,
    kernel: rawOs["kernel-release"] || "",
  };
  if (!Object.values(os).every((value) => text(value)))
    throw new Error("Некорректные сведения о гостевой ОС");
  if (os.id === "mswindows") {
    const data = JSON.parse(output.replace(/^\uFEFF/, ""));
    if (/^[A-Fa-f0-9]{8}$/.test(data.errorCode || ""))
      throw new Error(
        `Windows Update не завершил проверку (код 0x${data.errorCode})`,
      );
    if (
      data.schema !== 1 ||
      data.resultCode !== 2 ||
      !/^\d+\.\d+$/.test(data.build) ||
      !Array.isArray(data.updates) ||
      data.updates.length > 2000
    )
      throw new Error("Windows Update не завершил проверку");
    for (const u of data.updates) {
      if (
        !text(u.id) ||
        !text(u.title, 1000) ||
        !text(u.severity) ||
        typeof u.security !== "boolean" ||
        !Array.isArray(u.kb) ||
        !u.kb.every((v) => /^\d{4,10}$/.test(v)) ||
        !Array.isArray(u.cves) ||
        !u.cves.every((v) => /^CVE-\d{4}-\d{4,}$/.test(v))
      )
        throw new Error("Некорректный ответ Windows Update");
    }
    if (data.installationType !== undefined && !text(data.installationType))
      throw new Error("Некорректный тип установки Windows");
    return {
      os: {
        ...os,
        build: data.build,
        installationType: data.installationType || null,
      },
      updates: data.updates,
      rebootRequired: Boolean(data.rebootRequired),
    };
  }
  const lines = output.trimEnd().split(/\r?\n/);
  if (lines.shift() !== "HD_GUEST_INVENTORY_V1" || lines.length > 15000)
    throw new Error("Некорректный список пакетов гостевой ОС");
  const packages = [];
  for (const line of lines) {
    const [status, binary, version, source, sourceVersion, extra] =
      line.split("\t");
    if (status !== "installed") continue;
    if (
      extra !== undefined ||
      !/^[a-z0-9][a-z0-9+.-]*(?::[a-z0-9_-]+)?$/.test(binary || "") ||
      !/^[a-z0-9][a-z0-9+.-]*$/.test(source || "") ||
      !text(version) ||
      !version ||
      !text(sourceVersion) ||
      !sourceVersion
    )
      throw new Error("Не удалось прочитать версии пакетов гостевой ОС");
    packages.push({
      name: binary.split(":")[0],
      version,
      source,
      sourceVersion,
    });
  }
  if (!packages.length) throw new Error("Агент вернул пустой список пакетов");
  return { os, packages };
};
module.exports = { collectorFor, parseInventory };
