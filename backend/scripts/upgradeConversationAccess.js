require('module-alias/register');
const { randomUUID } = require('node:crypto');
const GLOBAL_ROLE = 'conversation-global-read-migrated';
const has = (s, r, a) => Array.isArray(s[r]) && s[r].includes(a);
const planRole = statements => {
  const actions = [...(statements.conversation || [])];
  if (has(statements, 'conversation', 'read') && has(statements, 'ticket', 'readAll')) actions.push('readAll');
  if (has(statements, 'conversation', 'reply')) actions.push('start');
  return actions.length ? { ...statements, conversation: [...new Set(actions)] } : statements;
};
const memberNeedsGlobalRead = (role, roles) => {
  const statements = String(role || '').split(',').map(key => roles.get(key.trim()) || {});
  return statements.some(s => has(s, 'conversation', 'read')) && statements.some(s => has(s, 'ticket', 'readAll')) && !statements.some(s => has(planRole(s), 'conversation', 'readAll'));
};
const upgradeConversationAccess = async (db, orgId, { apply = false, invalidateRoles = () => {}, refreshMirrorFor = async () => {} } = {}) => {
  const collection = db.collection('organizationRole');
  const rows = await collection.find({ organizationId: orgId }).toArray();
  const roles = new Map();
  for (const row of rows) {
    if (row.audience === 'client') continue;
    try { const value = JSON.parse(row.permission); if (value && typeof value === 'object') roles.set(row.role, value); } catch { /* Invalid roles grant nothing. */ }
  }
  const members = await db.collection('member').find({ organizationId: orgId }).toArray();
  const splitMembers = members.filter(member => memberNeedsGlobalRead(member.role, roles));
  // Never add global reading to a shared restricted role merely because one holder
  // also has ticket.readAll. Give only those holders a separate explicit role.
  if (splitMembers.length && apply) {
    const existing = rows.find(row => row.role === GLOBAL_ROLE);
    const permission = JSON.stringify({ conversation: ['readAll'] });
    if (existing && existing.permission !== permission) throw Error('Migration role name is already in use');
    await collection.updateOne({ organizationId: orgId, role: GLOBAL_ROLE }, { $setOnInsert: { _id: randomUUID(), organizationId: orgId, role: GLOBAL_ROLE, title: 'Все диалоги (перенесённый доступ)', audience: 'staff', permission, createdAt: new Date(), updatedAt: new Date() } }, { upsert: true });
    for (const member of splitMembers) {
      const keys = String(member.role).split(',').map(key => key.trim());
      if (keys.includes(GLOBAL_ROLE)) continue;
      const result = await db.collection('member').updateOne({ _id: member._id, role: member.role }, { $set: { role: [...keys, GLOBAL_ROLE].join(',') } });
      if (!result.matchedCount) throw Error('Membership changed during migration');
    }
  }
  const changed = [];
  for (const row of rows) {
    if (!roles.has(row.role)) continue;
    const permission = JSON.stringify(planRole(roles.get(row.role)));
    if (permission === row.permission) continue;
    changed.push(row.role);
    if (apply) {
      const result = await collection.updateOne({ _id: row._id, permission: row.permission }, { $set: { permission, updatedAt: new Date() } });
      if (!result.matchedCount) throw Error('Role changed during migration');
    }
  }
  if (apply) {
    // Existing logs contain display names, not immutable responsible IDs. Only
    // explicit IDs in current assignments and the surviving removal queue qualify.
    await db.collection('tickets').updateMany({}, [{ $set: { messagingReaderIds: { $setUnion: [ { $ifNull: ['$messagingReaderIds', []] }, { $ifNull: ['$responsibles._id', []] }, { $ifNull: ['$removedFromResponsibles._id', []] } ] } } }]);
    await db.collection('tickets').createIndex({ messagingReaderIds: 1 });
    invalidateRoles();
    // Repeat refresh on retry even if all writes succeeded before interruption.
    for (const key of roles.keys()) await refreshMirrorFor(orgId, key);
    if (splitMembers.length) await refreshMirrorFor(orgId, GLOBAL_ROLE);
  }
  return { changed, splitMembers: splitMembers.map(member => member._id) };
};
const run = async () => {
  const mongoose = require('mongoose');
  const { organizationId, invalidateRoles } = require('../services/permissions');
  const { refreshMirrorFor } = require('../services/roles');
  try {
    await mongoose.connect(`mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`);
    const orgId = await organizationId();
    if (!orgId) throw Error('Organization missing');
    console.log(await upgradeConversationAccess(mongoose.connection.db, orgId, { apply: process.argv.includes('--apply'), invalidateRoles, refreshMirrorFor }));
  } finally { await mongoose.disconnect(); }
};
module.exports = { planRole, memberNeedsGlobalRead, upgradeConversationAccess };
if (require.main === module) run().catch(error => { console.error(error.message); process.exitCode = 1; });
