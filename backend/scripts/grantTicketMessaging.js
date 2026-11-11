require('module-alias/register');
const { isFullAccess } = require('../auth/access');

const withSending = statements => ({ ...statements, ticket: [...new Set([...(statements.ticket || []), 'sendMessage'])] });
const administrator = statements => [['role', 'manage'], ['user', 'manageAccess'], ['settings', 'manage']].every(([resource, action]) => statements[resource]?.includes(action));
// Split an existing capability without silently granting inbox visibility.
const upgradeTicketMessagingRoles = async (db, orgId, { apply = false, invalidateRoles, refreshMirrorFor } = {}) => {
  const rows = await db.collection('organizationRole').find({ organizationId: orgId }).toArray();
  const roles = [];
  for (const row of rows) {
    if (row.audience === 'client') continue;
    try { roles.push({ row, statements: JSON.parse(row.permission || '{}') || {} }); }
    catch { /* Preserve malformed roles for an administrator to repair. */ }
  }
  const refreshed = roles.filter(({ statements }) => isFullAccess(withSending(statements))).map(({ row }) => row.role);
  const changed = [];
  for (const { row, statements } of roles) {
    if (statements.ticket?.includes('sendMessage')) continue;
    if (!statements.conversation?.includes('reply') && !administrator(statements) && !isFullAccess(withSending(statements))) continue;
    changed.push(row.role);
    if (apply) {
      const result = await db.collection('organizationRole').updateOne({ _id: row._id, permission: row.permission }, { $set: { permission: JSON.stringify(withSending(statements)), updatedAt: new Date() } });
      if (!result.matchedCount) throw Error('Роль изменилась во время миграции; повторите миграцию при остановленном приложении');
    }
  }
  if (apply) {
    invalidateRoles();
    for (const key of refreshed) await refreshMirrorFor(orgId, key);
  }
  return { changed, refreshed };
};

const run = async () => {
  const mongoose = require('mongoose');
  const { organizationId, invalidateRoles } = require('../services/permissions');
  const { refreshMirrorFor } = require('../services/roles');
  try {
    await mongoose.connect(`mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`);
    const orgId = await organizationId();
    if (!orgId) throw Error('Организации нет — раздавать права некому');
    const apply = process.argv.includes('--apply');
    const result = await upgradeTicketMessagingRoles(mongoose.connection.db, orgId, { apply, invalidateRoles, refreshMirrorFor });
    console.log(`${apply ? 'Миграция выполнена' : 'Показ без записи'}: ролей к дополнению ${result.changed.length}, зеркал к пересчёту ${result.refreshed.length}`);
  } finally { await mongoose.disconnect(); }
};
module.exports = { upgradeTicketMessagingRoles };
if (require.main === module) run().catch(error => { console.error(error.message); process.exitCode = 1; });
