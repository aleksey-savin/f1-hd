// These commands are owned by HD. No request/VM strings are interpolated into them.
// They read package metadata or search Windows Update; they never install updates.
const LINUX_SCRIPT = `set -eu
export LC_ALL=C
printf 'HD_GUEST_INVENTORY_V1\\n'
dpkg-query -W -f='\${db:Status-Status}\\t\${binary:Package}\\t\${Version}\\t\${source:Package}\\t\${source:Version}\\n'
`;
const WINDOWS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$os = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
$data = @{ schema = 1; build = "$($os.CurrentBuildNumber).$($os.UBR)"; installationType = [string]$os.InstallationType; rebootRequired = $null; updates = @(); windowsUpdate = @{ status = 'error'; errorCode = $null } }
try {
  $data.rebootRequired = [bool]((Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired') -or (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending'))
} catch { }
# All potentially blocking WUA COM calls live in this one owned child process.
$childScript = @'
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
  $session = New-Object -ComObject Microsoft.Update.Session
  $session.ClientApplicationID = 'HD guest security inventory'
  $searcher = $session.CreateUpdateSearcher()
  $searcher.Online = $true
  $result = $searcher.Search("IsInstalled=0 and Type='Software'")
  if ([int]$result.ResultCode -ne 2) { throw 'Windows Update returned incomplete results' }
  $script:count = 0
  function Read-Update($update) {
    $script:count++
    if ($script:count -gt 2000) { throw 'Too many updates' }
    $cves = @($update.CveIDs | ForEach-Object { [string]$_ })
    return @{
      id = [string]$update.Identity.UpdateID
      title = [string]$update.Title
      kb = @($update.KBArticleIDs | ForEach-Object { [string]$_ })
      cves = $cves
      severity = [string]$update.MsrcSeverity
      security = [bool]($update.MsrcSeverity -or $cves.Count -gt 0 -or @($update.Categories | Where-Object { $_.CategoryID -eq '0fa1201d-4330-4fa8-8ae9-b877473b6441' }).Count -gt 0)
    }
  }
  $offline = $session.CreateUpdateSearcher()
  $offline.Online = $false
  function Read-Components($update, [int]$depth) {
    if ($depth -ge 2) {
      if ($update.BundledUpdates.Count -gt 0) { $script:componentCoverageIncomplete = $true }
      return
    }
    foreach ($child in $update.BundledUpdates) {
      if ($child.IsInstalled) { continue }
      $id = [string]$child.Identity.UpdateID
      if ($id -notmatch '^[0-9a-fA-F-]{36}$') { continue }
      # Bundling alone does not prove applicability; use the local WUA search.
      try {
        $found = $offline.Search("IsInstalled=0 and UpdateID='$id'")
      } catch {
        $script:componentCoverageIncomplete = $true
        continue
      }
      if ([int]$found.ResultCode -ne 2) {
        $script:componentCoverageIncomplete = $true
        continue
      }
      foreach ($applicable in $found.Updates) {
        if ($applicable.Identity.UpdateID -eq $id -and $applicable.Identity.RevisionNumber -eq $child.Identity.RevisionNumber -and -not $applicable.IsInstalled) {
          Read-Update $applicable
          Read-Components $applicable ($depth + 1)
        }
      }
    }
  }
  $updates = @()
  foreach ($update in $result.Updates) {
    $entry = Read-Update $update
    $script:componentCoverageIncomplete = $false
    $entry.componentUpdates = @(Read-Components $update 0)
    $entry.componentCoverageIncomplete = $script:componentCoverageIncomplete
    $updates += $entry
  }
  @{ resultCode = 2; updates = $updates; windowsUpdate = @{ status = 'completed'; errorCode = $null } } | ConvertTo-Json -Depth 8 -Compress
} catch {
  $exception = $_.Exception
  for ($i = 0; $i -lt 8 -and $exception.InnerException; $i++) { $exception = $exception.InnerException }
  @{ updates = @(); windowsUpdate = @{ status = 'error'; errorCode = ('{0:X8}' -f ($exception.HResult -band 0xffffffffL)) } } | ConvertTo-Json -Depth 8 -Compress
}
'@
$process = New-Object System.Diagnostics.Process
$process.StartInfo.FileName = "$PSHOME\powershell.exe"
$process.StartInfo.Arguments = '-NoLogo -NoProfile -NonInteractive -EncodedCommand ' + [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($childScript))
$process.StartInfo.UseShellExecute = $false
$process.StartInfo.CreateNoWindow = $true
$process.StartInfo.RedirectStandardOutput = $true
$process.StartInfo.RedirectStandardError = $true
$process.StartInfo.StandardOutputEncoding = New-Object System.Text.UTF8Encoding($false)
$started = $false
try {
  $started = $process.Start()
  # Drain both pipes while waiting, so large inventories cannot deadlock the child.
  $stdout = $process.StandardOutput.ReadToEndAsync()
  $stderr = $process.StandardError.ReadToEndAsync()
  if (-not $process.WaitForExit(180000)) {
    $data.windowsUpdate = @{ status = 'timeout'; errorCode = $null }
  } elseif ($process.ExitCode -eq 0 -and $stdout.Wait(1000)) {
    $result = $stdout.Result | ConvertFrom-Json
    $data.windowsUpdate = $result.windowsUpdate
    $data.updates = @($result.updates)
    if ($result.resultCode -eq 2) { $data.resultCode = 2 }
  }
} catch {
  $data.windowsUpdate = @{ status = 'error'; errorCode = $null }
} finally {
  if ($started) {
    try {
      if (-not $process.HasExited) {
        $process.Kill()
        [void]$process.WaitForExit(5000)
      }
    } catch { }
  }
  $process.Dispose()
}
$data | ConvertTo-Json -Depth 10 -Compress
`;
const collectorFor = (os) => {
  if (os.id === "fedora") return require("./fedora-inventory").collectorForFedora();
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
  if (rawOs.id === "fedora") return require("./fedora-inventory").parseFedoraInventory(rawOs, output);
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
    const windowsUpdate = data.windowsUpdate || { status: "completed", errorCode: null };
    const partial = ["error", "timeout"].includes(windowsUpdate.status);
    if (
      data.schema !== 1 ||
      !["completed", "error", "timeout"].includes(windowsUpdate.status) ||
      (windowsUpdate.errorCode !== null && !/^[A-Fa-f0-9]{8}$/.test(windowsUpdate.errorCode || "")) ||
      (!partial && data.resultCode !== 2) ||
      !/^\d+\.\d+$/.test(data.build) ||
      !Array.isArray(data.updates) ||
      (partial && data.updates.length !== 0) ||
      (data.rebootRequired !== undefined && data.rebootRequired !== null && typeof data.rebootRequired !== "boolean")
    )
      throw new Error("Windows Update не завершил проверку");
    let count = 0;
    const validateUpdate = (u, component = false) => {
      if (
        !u || typeof u !== "object" || ++count > 2000 ||
        !text(u.id) ||
        !text(u.title, 1000) ||
        !text(u.severity) ||
        typeof u.security !== "boolean" ||
        (u.componentCoverageIncomplete !== undefined && typeof u.componentCoverageIncomplete !== "boolean") ||
        !Array.isArray(u.kb) ||
        !u.kb.every((v) => /^\d{4,10}$/.test(v)) ||
        !Array.isArray(u.cves) ||
        !u.cves.every((v) => /^CVE-\d{4}-\d{4,}$/.test(v)) ||
        (u.componentUpdates !== undefined && (component || !Array.isArray(u.componentUpdates)))
      )
        throw new Error("Некорректный ответ Windows Update");
      for (const child of u.componentUpdates || []) validateUpdate(child, true);
    };
    for (const u of data.updates) validateUpdate(u);
    if (data.installationType !== undefined && !text(data.installationType))
      throw new Error("Некорректный тип установки Windows");
    return {
      os: {
        ...os,
        build: data.build,
        installationType: data.installationType || null,
      },
      updates: data.updates,
      rebootRequired: data.rebootRequired ?? null,
      windowsUpdate: { status: windowsUpdate.status, errorCode: windowsUpdate.errorCode?.toUpperCase() || null },
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
