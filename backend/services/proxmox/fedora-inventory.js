// Fedora 42 uses DNF5 5.2: advisory info JSON is a dictionary keyed by ID.
// DNF5 5.3 changed it to an array; both are documented by upstream:
// https://dnf5.readthedocs.io/en/stable/api/changes_dnf5.3.html
// The fixed guest command only queries RPM and refreshes repository metadata.
// No package names or machine data are sent to an external matching service.
const FEDORA_SCRIPT = String.raw`set -eu
export LC_ALL=C
/usr/bin/python3 - <<'HD_FEDORA_PY'
import json, re, subprocess, datetime
try:
    import rpm
except ImportError:
    print(json.dumps(dict(schema=1, errorCode='RPM_BINDINGS_UNAVAILABLE')))
    raise SystemExit(0)

packages = []
# Read installed headers through librpm. No rpm subprocess or transaction run.
try:
    transaction = rpm.TransactionSet()
    for header in transaction.dbMatch():
        name, version, release, arch = (str(header[key]) for key in ('name', 'version', 'release', 'arch'))
        epoch = str(header['epoch'] or 0)
        source = str(header['sourcerpm'] or '')
        signature_key = None
        try:
            signature = header.sprintf('%{RSAHEADER:pgpsig}')
            key_match = re.search(r'Key ID ([0-9a-fA-F]{16})$', signature)
            if key_match:
                signature_key = key_match.group(1).lower()
        except (rpm.error, ValueError, KeyError):
            pass
        packages.append(dict(signatureKeyId=signature_key, name=name, version=epoch+':'+version+'-'+release, arch=arch, source=source, sourceVersion=epoch+':'+version+'-'+release))
except (rpm.error, OSError, KeyError, TypeError, ValueError):
    print(json.dumps(dict(schema=1, errorCode='RPM_DATABASE_UNAVAILABLE')))
    raise SystemExit(0)

def parse_nevra(nevra):
    nvr, arch = nevra.rsplit('.', 1)
    name, ev, release = nvr.rsplit('-', 2)
    epoch, version = ev.split(':', 1) if ':' in ev else ('0', ev)
    if not epoch.isdigit():
        raise ValueError('Invalid RPM epoch')
    return name, (epoch, version, release), arch

def evr(version):
    ev, release = version.rsplit('-', 1)
    epoch, version = ev.split(':', 1)
    return epoch, version, release

advisories = []
metadata_ok = False
metadata_error = None
try:
    # Explicit repositories exclude COPR and other third-party updateinfo.
    # Refresh + mandatory availability prevents silently accepting stale cache.
    response = subprocess.run(['/usr/bin/dnf5', '--quiet', '--refresh', '--repo=fedora', '--repo=updates', '--setopt=*.skip_if_unavailable=False', 'advisory', 'info', '--all', '--security', '--json'], check=True, capture_output=True, text=True, timeout=150)
    data = json.loads(response.stdout)
    rows = list(data.values()) if isinstance(data, dict) else data
    if not isinstance(rows, list):
        raise ValueError('Invalid advisory collection')
    by_package = {}
    for p in packages:
        by_package.setdefault((p['name'], p['arch']), []).append(p)
    for row in rows:
        if not isinstance(row, dict) or not re.fullmatch(r'FEDORA-\d{4}-[a-f0-9]+', row['Name']):
            raise ValueError('Invalid Fedora advisory')
        if row['Type'] != 'security':
            continue
        cves = [r['Id'] for r in row['references'] if r['Type'] == 'cve']
        matches = []
        for nevra in row['collections'].get('packages', []):
            name, fixed, arch = parse_nevra(nevra)
            for p in by_package.get((name, arch), []):
                if rpm.labelCompare(evr(p['version']), fixed) < 0:
                    matches.append(dict(name=name, version=p['version'], arch=arch, fixedVersion=fixed[0]+':'+fixed[1]+'-'+fixed[2]))
        if matches:
            advisories.append(dict(id=row['Name'], cves=cves, severity=row['Severity'], packages=matches))
    metadata_ok = True
except (OSError, subprocess.SubprocessError, ValueError, KeyError, TypeError) as error:
    metadata_error = 'permission_denied' if isinstance(error, PermissionError) else 'unavailable'
    # Never retain an incomplete prefix of a malformed/failed metadata response.
    advisories = []
print(json.dumps(dict(schema=1, packages=packages, fedora=dict(advisories=advisories, metadataAvailable=metadata_ok, metadataError=metadata_error, checkedAt=datetime.datetime.now(datetime.timezone.utc).isoformat()))))
HD_FEDORA_PY
`;
const collectorForFedora = () => ['/bin/sh', '-c', FEDORA_SCRIPT];
const safeText = (s, max = 300) => typeof s === 'string' && s.length <= max && [...s].every(c => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127);
const rpmName = s => typeof s === 'string' && /^[A-Za-z0-9][A-Za-z0-9+_.-]*$/.test(s) && s.length <= 300;
const rpmVersion = s => safeText(s) && /^\d+:[^-\s]+-[^-\s]+$/.test(s);
const validPackage = p => p && rpmName(p.name) && rpmName(p.arch) && rpmVersion(p.version);
const parseFedoraInventory = (rawOs, output) => {
  const invalid = () => { throw new Error('Некорректный ответ сборщика Fedora RPM / DNF'); };
  if (typeof output !== 'string' || Buffer.byteLength(output) > 2 * 1024 * 1024) invalid();
  const data = JSON.parse(output);
  const errors = {
    RPM_DATABASE_UNAVAILABLE: 'Не удалось прочитать базу RPM через агент QEMU. Проверьте права агента и состояние базы пакетов.',
    RPM_BINDINGS_UNAVAILABLE: 'Через агент QEMU недоступен модуль Python rpm, необходимый для чтения пакетов Fedora.',
  };
  if (data?.schema === 1 && Object.hasOwn(errors, data.errorCode)) throw new Error(errors[data.errorCode]);
  if (!data || typeof data !== 'object' || data.errorCode !== undefined) invalid();
  const os = { id: rawOs.id, version: rawOs['version-id'] || '', name: rawOs['pretty-name'] || rawOs.name || rawOs.id, kernel: rawOs['kernel-release'] || '' };
  if (os.id !== 'fedora' || !Object.values(os).every(v => safeText(v)) || !/^\d+$/.test(os.version)) invalid();
  if (data.schema !== 1 || !Array.isArray(data.packages) || !data.packages.length || data.packages.length > 15000 || !data.packages.every(p => validPackage(p) && (p.signatureKeyId == null || /^[0-9a-f]{16}$/.test(p.signatureKeyId)) && safeText(p.source) && rpmVersion(p.sourceVersion))) invalid();
  const fedora = data.fedora;
  if (!fedora || typeof fedora.metadataAvailable !== 'boolean' || !safeText(fedora.checkedAt) || !Number.isFinite(Date.parse(fedora.checkedAt)) || !Array.isArray(fedora.advisories) || fedora.advisories.length > 10000) invalid();
  if (fedora.metadataError != null && !['permission_denied', 'unavailable'].includes(fedora.metadataError)) invalid();
  const installed = new Set(data.packages.map(p => JSON.stringify([p.name, p.arch, p.version])));
  for (const a of fedora.advisories) {
    if (!a || !/^FEDORA-\d{4}-[a-f0-9]+$/.test(a.id) || !safeText(a.severity) || !Array.isArray(a.cves) || !a.cves.every(c => /^CVE-\d{4}-\d{4,}$/.test(c)) || !Array.isArray(a.packages) || !a.packages.length || !a.packages.every(p => validPackage(p) && rpmVersion(p.fixedVersion) && installed.has(JSON.stringify([p.name, p.arch, p.version])))) invalid();
  }
  if (!fedora.metadataAvailable && fedora.advisories.length) invalid();
  return { os, packages: data.packages, fedora };
};
module.exports = { collectorForFedora, parseFedoraInventory };
