# ops/

Internal tooling of the operator. It is not part of the product, is excluded
from every image, and is not meant for customers.

## Copying production into a development or test database

`ops/sync-dev-db.sh` fills the MongoDB of the machine it runs on with the data
of another installation. Production is only ever read: the dump is made on the
source side and streamed over SSH.

Configuration lives in `ops/sync.env` (ignored by git); start from
`ops/sync.env.example`:

- `PROD_SSH` - SSH target of the source, `user@host` (required)
- `PROD_SSH_JUMP` - optional jump host, used when the source is not reachable directly
- `DEV_MONGO_HOST` - where the target MongoDB is published (default `127.0.0.1`)
- `DEV_PASSWORD` - the password every account gets in a masked copy (required in masked mode)

Run it from anywhere inside the checkout; `ops/sync-dev-db.sh --help` lists the options.

### On a workstation

```bash
ops/sync-dev-db.sh
```

### On a test host

Run the script on the test host itself. It needs SSH access to the source
(your key, or `ssh -A` when you log in) and nothing else - when `mongorestore`
is not installed it uses the one inside the `mongodb` container. A host
installed with `deploy.sh` cannot make a masked copy (the default mode is
refused there), so the copy is a raw one and only for data that is your own:

```bash
ops/sync-dev-db.sh --raw  # replaces every collection except the ones kept locally
./deploy.sh migrate up    # whatever this code has that the source has not
```

For a masked copy on a test host see "Test hosts and masking" below.

The script finds the source containers by itself. The copy brings the source
`migrations` ledger along, so `migrate up` runs only the entries the source has
not applied yet.

### Modes

- masked (default): after the restore, identity fields are masked and every
  account signs in with `DEV_PASSWORD` (see "Masked copies" below).
- `--raw`: everything is copied as it is. It asks for a typed `RAW`
  confirmation unless `--yes` is given. Use it only for an installation whose
  data is your own.

### What is never copied

- Kept as they are on the target (the target's own settings): `preferences`,
  `channels`, `channeljobs`.
- Live credentials, dropped on the target: `authSessions`, `authVerifications`,
  `mcpkeys`, `mikrotikdownloadcodes`, `impersonationCodes`, `telegramPairingCodes`.

A copy must not be able to act as a signed-in person or as an agent of the
source installation.

### Masked copies

After the restore the script runs `backend/scripts/dev/maskData.js` in the
development backend container. Everything is derived from the document `_id`,
so a second run changes nothing and the same person looks the same everywhere.

What is rewritten:

- People (`users`, and the backup `users_before_banned`): first name becomes
  `Сотрудник` or `Клиент`, last name the last six characters of the id, e-mail
  `u<id>@example.com`, phone `7900…`. Avatars, the Telegram link, the directory
  GUID and the personal remote-access key are removed.
- Companies: `Компания <id6>`, legal title, phones, address, map link and
  location; e-mail domains and API keys are emptied. Subdivisions and suppliers
  get the same treatment (name, contacts, address, tax ids).
- Copies of those names kept inside other documents - applicants, responsibles
  and authors in tickets, works, comments, logs, templates, reports,
  notifications, knowledge notes and so on. The list is the `SNAPSHOTS` table in
  the script; a snapshot shows the same masked name as the record it was taken
  from.
- Other identifying fields: directory logins and computer names in the company
  log, recipients in the notification queue, the sender of a mailed ticket and
  the Message-ID of mailed tickets and comments (it carries the sender's mail
  host, usually the client's domain), messenger chat ids in conversations, the
  organization name.
- Credentials: every password becomes `DEV_PASSWORD`; legacy password and token
  fields, two-factor secrets, report approval links, remote-access session
  links, licence keys in device records, sign-ins through external providers
  and messenger identities are removed. The collections listed under "What is never copied" are dropped
  again, in case the copy was made some other way.

- Device and integration secrets: the stored password and port-knock sequence
  of every Mikrotik record, WireGuard private and pre-shared keys kept with
  change requests, licence keys of installed software. Monitoring and the
  backup/export schedules of every router are switched off. A masked copy
  cannot reach the devices of the installation it was copied from - that is the
  point; an installation of your own is copied with `--raw`. Addresses, logins
  and pinned TLS/SSH fingerprints stay as part of the device record.

Signing in: any account that had a password, with its masked e-mail
(`u<id>@example.com` - look it up in the user list or in `users`) and
`DEV_PASSWORD`. Disabled accounts stay disabled; accounts that were only
invited still have no password.

`maskData.js --report` masks and then walks the whole database looking for the
e-mail addresses, phones and names it has just replaced. It prints
`collection.path: count` in three groups: structured fields, which mean a
snapshot is missing from the script - in that case it exits with 1 and the sync
fails; free text, which is expected; and device records and labels (inventory,
Mikrotik, location names, job titles inside snapshots, category and service
titles), which are left as they are on purpose. Which field belongs where is
declared in the script (`FREE_TEXT`, `LABELS`) and checked against the models
by its test: a new text field in a model fails the test until it is classified. Ask for it when a model gains a new
embedded person or company (it only works on a copy that is not masked yet; a
second run has nothing to look for):

```bash
MASK_REPORT=1 ops/sync-dev-db.sh
```

Only the value `1` turns it on.

Guards. Before anything is dumped or dropped, the sync asks the masking
script which database its container actually connects to (`--target`) and
stops unless that is the very database about to be restored. The masking
script itself refuses to run with `NODE_ENV=production` (or with `NODE_ENV`
unset), without `DEV_PASSWORD`, and against a database whose name looks like a
production one (contains `prod`). The sync passes the target database name to
the container as `MONGODB_DATABASE`, so the comparison with that variable
inside the script is not an independent check - the `--target` round trip is.

A masked run cannot end in success with real data in place. Before anything is
downloaded or dropped the sync script checks that masking can run here - the
script starts in the backend container and connects to the very database that
is about to be restored; a failed masking is an error that says the copy still
holds real data; and after masking it checks that no account is left with an
address outside `example.com`.

If a run fails after the restore, the database holds real data, possibly half
masked. Credentials go first, so password hashes and two-factor secrets are
already gone, but names may not be. Re-run the sync from the kept archive (the
failed run prints its path):

```bash
ops/sync-dev-db.sh --from-archive /path/to/hd-db-sync-....archive.gz
```

or drop the database. The dump archive is always raw, in masked mode too: a
failed run or `--keep-dump` leaves real names and password hashes in the
temporary directory (`$TMPDIR`, `/tmp` when it is not set), in the file
`hd-db-sync-<date>-<suffix>.archive.gz` whose path the run prints. Delete it
as soon as it is no longer needed.

Do not run `maskData.js` again by hand on such a copy:
some snapshots have no reference to the person and are matched by the name
they carry, and once `users` is masked those names can no longer be matched -
they all become `Клиент 000000`.

### Test hosts and masking

Masking needs the development stack: `compose.dev.yml` active, the `mongodb`
service of that stack as the target, and the backend sources mounted into the
container. A host installed with `deploy.sh` has none of that - its image does
not contain `scripts/dev` and runs in production mode - so a masked run is
refused there before anything is dumped:

    A masked copy needs the development stack. On a host installed with
    deploy.sh use --raw, and only for your own data.

To rehearse a migration on masked data, make the masked copy on a workstation
and move it to the test host - without the three collections that belong to
each installation (the workstation's mail and messenger settings must not
replace the test host's):

```bash
# on the workstation
mongodump --db <dev database> --archive=masked.archive.gz --gzip \
  --excludeCollection=preferences --excludeCollection=channels --excludeCollection=channeljobs

# on the test host; --nsExclude also covers an archive made without the excludes
mongorestore --archive=masked.archive.gz --gzip --drop \
  --nsInclude='<dev database>.*' --nsFrom='<dev database>.*' --nsTo='<test database>.*' \
  --nsExclude='<dev database>.preferences' --nsExclude='<dev database>.channels' --nsExclude='<dev database>.channeljobs'
```

Add the connection options of each side (`--host`, `--username`, `--password`,
`--authenticationDatabase admin`).

### Limit

Masking covers identity fields; free text (tickets, comments, messages, work
descriptions, the rendered text of notifications, call transcripts, file
names) and device records (inventory, Mikrotik records without their secrets,
locations) are copied as they are, so a masked copy is pseudonymised, not
anonymous. Text that describes device configuration - the commands of Mikrotik
change requests, the event journal, knowledge notes - is free text too and may
contain passwords written into it. Backup and export files of routers are not
in the database and are not copied at all. Job titles, salaries and ban reasons also stay.
The target's own `preferences`, `channels` and `channeljobs` are not touched.
