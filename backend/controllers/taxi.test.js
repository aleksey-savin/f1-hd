const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
require("module-alias/register");
const stub = (path, exports) => {
  const filename = require.resolve(path);
  const cached = new Module(filename);
  Object.assign(cached, { filename, loaded: true, exports });
  require.cache[filename] = cached;
};
stub("../utils/logger", { log() {} });
const Ticket = { findById: async () => null, find: () => ({ select: () => ({ lean: async () => [] }) }) };
stub("../models/ticket", { Ticket });
const controller = require("./taxi");
const { TaxiTrip, TaxiSettings, TaxiEmployee } = require("../models/taxi");
const Work = require("../models/work");
const User = require("../models/user");
const Company = require("../models/company");
const sift = require("sift").default;
const { Types } = require("mongoose");
const ownId = "64f1a2b3c4d5e6f708192a3b";
const invoke = async (handler, overrides = {}) => {
  let error, body;
  const req = { auth: { userId: ownId, isEndUser: false, can: () => false }, query: {}, params: {}, body: {}, ...overrides };
  await handler(req, { json(value) { body = value; }, status() { return this; } }, (value) => { error = value; });
  return { error, body };
};
test("all corporate taxi endpoints reject clients before touching corporate data", async () => {
  for (const name of ["list", "settings", "saveSettings", "check", "sync", "mapEmployee", "candidates", "ticketTrips", "ticketCandidates", "allocate", "detail", "remove", "allocationOptions"]) {
    const { error } = await invoke(controller[name], { auth: { userId: ownId, isEndUser: true, can: () => true } });
    assert.equal(error?.statusCode, 403, name);
  }
});
test("report cannot select another employee or global scope without the report permission", async () => {
  const other = await invoke(controller.list, { query: { userId: "64f1a2b3c4d5e6f708192a3c" } });
  assert.equal(other.error?.statusCode, 403);
  const all = await invoke(controller.list, { query: { scope: "all" } });
  assert.equal(all.error?.statusCode, 403);
});
test("report rejects staff without any taxi permission before reading saved trips", async (t) => {
  let reads = 0;
  t.mock.method(TaxiTrip, "aggregate", async () => { reads++; return []; });
  const { error } = await invoke(controller.list);
  assert.equal(error?.statusCode, 403);
  assert.equal(reads, 0);
});
test("configuration privilege is independent of broad trip visibility", async () => {
  const { error } = await invoke(controller.settings, { auth: { userId: ownId, isEndUser: false, can: ({ taxi }) => taxi?.includes("read") } });
  assert.equal(error?.statusCode, 403);
});

test("closing with no actual works cannot invent a visit at the current time", async (t) => {
  const ticketId = "64f1a2b3c4d5e6f708192a3c";
  t.mock.method(Ticket, "findById", async () => ({ _id: ticketId, company: { _id: ticketId }, createdBy: ownId }));
  t.mock.method(Work, "find", () => ({ lean: async () => [] }));
  let tripReads = 0;
  t.mock.method(TaxiTrip, "find", () => { tripReads++; throw new Error("unexpected invented visit"); });
  const result = await invoke(controller.ticketCandidates, { params: { id: ticketId } });
  assert.equal(result.error, undefined);
  assert.deepEqual(result.body.trips, []);
  assert.equal(tripReads, 0);
});

test("a coworker's work does not hide one's own closing suggestions and complete trips match", async (t) => {
  const ticketId = "64f1a2b3c4d5e6f708192a3c";
  t.mock.method(Ticket, "findById", async () => ({ _id: ticketId, company: { _id: ticketId }, createdBy: ownId }));
  const actual = { company: ticketId, visitRequired: true, startedAt: new Date("2026-11-09T00:25:00Z"), finishedAt: new Date("2026-11-09T01:15:00Z"), taxiTripIds: [] };
  t.mock.method(Work, "find", () => ({ lean: async () => [ { ...actual, finishedBy: { _id: ownId } }, { ...actual, finishedBy: { _id: "64f1a2b3c4d5e6f708192a3d" } } ] }));
  const filters = [];
  t.mock.method(TaxiTrip, "find", (filter) => { filters.push(filter); return { sort: () => ({ limit: () => ({ lean: async () => [] }) }) }; });
  const result = await invoke(controller.ticketCandidates, { params: { id: ticketId } });
  assert.equal(result.error, undefined);
  assert.equal(filters.length, 1);
  assert.equal(String(filters[0].userId), ownId);
  assert.equal(sift(filters[0])({ userId: new Types.ObjectId(ownId), companyId: ticketId, purpose: "business", status: "complete", startedAt: new Date("2026-11-09T00:05:00Z") }), true);
});

test("saving visible work-derived links cannot make them permanent direct links", async (t) => {
  const companyId = "64f1a2b3c4d5e6f708192a3c", ticketId = "64f1a2b3c4d5e6f708192a3d";
  const trip = { _id: new Types.ObjectId(), userId: new Types.ObjectId(ownId), companyId: new Types.ObjectId(companyId), ticketIds: [], purpose: "business" };
  const work = { _id: "work", company: companyId, taxiTripIds: [trip._id], tickets: [ticketId] };
  const selection = (value) => ({ select: () => ({ lean: async () => value }), lean: async () => value });
  const ticket = { _id: ticketId, num: 1242, title: "Принтер", company: { _id: companyId }, createdBy: ownId };
  t.mock.method(Ticket, "find", () => Object.assign([ticket], { select: () => ({ lean: async () => [ticket] }) }));
  t.mock.method(TaxiTrip, "findById", () => selection(trip));
  t.mock.method(Company, "exists", async () => true);
  t.mock.method(TaxiTrip, "findOneAndUpdate", (_filter, change) => { Object.assign(trip, change.$set); return selection(trip); });
  t.mock.method(Work, "find", () => selection([work]));
  t.mock.method(Company, "findById", () => selection({ alias: "Клиент" }));
  t.mock.method(Company, "find", () => selection([{ _id: companyId, alias: "Клиент" }]));
  t.mock.method(User, "find", () => selection([{ _id: ownId }]));
  t.mock.method(User, "updateOne", async () => ({ modifiedCount: 0 }));
  t.mock.method(TaxiEmployee, "find", () => selection([]));
  const result = await invoke(controller.allocate, { params: { id: String(trip._id) }, body: { companyId, ticketIds: [ticketId], purpose: "business" } });
  assert.equal(result.error, undefined);
  assert.deepEqual(trip.ticketIds, []);
  assert.deepEqual(result.body.directTicketIds, []);
  assert.deepEqual(result.body.workTicketIds, [ticketId]);
  assert.deepEqual(result.body.ticketIds, [ticketId]);
});

test("allocation preserves invisible sibling links instead of deleting them from the visible editor", async (t) => {
  const companyId = "64f1a2b3c4d5e6f708192a3c", hiddenTicketId = "64f1a2b3c4d5e6f708192a3d";
  const trip = { _id: new Types.ObjectId(), userId: new Types.ObjectId(ownId), companyId: new Types.ObjectId(companyId), ticketIds: [new Types.ObjectId(hiddenTicketId)], purpose: "business" };
  const selection = (value) => ({ select: () => ({ lean: async () => value }), lean: async () => value });
  t.mock.method(TaxiTrip, "findById", () => selection(trip));
  t.mock.method(Company, "exists", async () => true);
  t.mock.method(TaxiTrip, "findOneAndUpdate", (_filter, change) => { Object.assign(trip, change.$set); return selection(trip); });
  t.mock.method(Work, "find", () => selection([]));
  t.mock.method(Company, "findById", () => selection({ alias: "Клиент" }));
  t.mock.method(Company, "find", () => selection([{ _id: companyId, alias: "Клиент" }]));
  t.mock.method(User, "find", () => selection([{ _id: ownId, firstName: "Максим", lastName: "Гурьянов" }]));
  t.mock.method(User, "updateOne", async () => ({ modifiedCount: 0 }));
  t.mock.method(TaxiEmployee, "find", () => selection([]));
  const result = await invoke(controller.allocate, { params: { id: String(trip._id) }, body: { companyId, purpose: "business", ticketIds: [] } });
  assert.equal(result.error, undefined);
  assert.deepEqual(trip.ticketIds.map(String), [hiddenTicketId]);
  assert.deepEqual(result.body.ticketIds, []);
  const changed = await invoke(controller.allocate, { params: { id: String(trip._id) }, body: { companyId: ownId, purpose: "business", ticketIds: [] } });
  assert.equal(changed.error?.statusCode, 409);
});

const chain = (value) => ({ select() { return this; }, sort() { return this; }, limit() { return this; }, lean: async () => value });
test('deleting expenses requires allocation permission and preserves a tombstone on repeated deletion', async (t) => {
  const trip = { _id: new Types.ObjectId(), userId: ownId, clientId: 'corp', externalId: 'retained-key', ticketIds: [] };
  let writes = 0, cleanups = 0;
  t.mock.method(TaxiTrip, 'findById', () => chain(trip));
  t.mock.method(TaxiTrip, 'updateOne', async (filter, update) => { if (sift(filter)(trip)) { writes++; Object.assign(trip, update.$set); } });
  t.mock.method(Work, 'updateMany', async (filter, update) => { assert.equal(String(filter.taxiTripIds), String(trip._id)); assert.equal(String(update.$pull.taxiTripIds), String(trip._id)); cleanups++; });
  const params = { id: String(trip._id) };
  assert.equal((await invoke(controller.remove, { params })).error?.statusCode, 403);
  for (let i = 0; i < 2; i++) assert.equal((await invoke(controller.remove, { params, auth: { userId: ownId, isEndUser: false, can: ({taxi}) => taxi?.includes('allocate') } })).body.ok, true);
  assert.equal(writes, 1); assert.equal(cleanups, 2);
  assert.ok(trip.deletedAt); assert.equal(String(trip.deletedBy), ownId);
  assert.equal(trip.externalId, 'retained-key');
  assert.equal((await invoke(controller.detail, { params })).error?.statusCode, 404);
});

test('allocation suggestions use the stored passenger, selected company and viewing scope', async (t) => {
  const passenger = new Types.ObjectId(), company = new Types.ObjectId();
  const trip = { _id: new Types.ObjectId(), userId: passenger };
  const good = { _id: new Types.ObjectId(), num: 1, company: { _id: company }, responsibles: [{ _id: passenger }], createdBy: new Types.ObjectId(ownId) };
  const otherStaff = { ...good, _id: new Types.ObjectId(), responsibles: [{ _id: new Types.ObjectId() }] };
  const otherCompany = { ...good, _id: new Types.ObjectId(), company: { _id: new Types.ObjectId() } };
  const hidden = { ...good, _id: new Types.ObjectId(), createdBy: new Types.ObjectId() };
  t.mock.method(TaxiTrip, 'findById', () => chain(trip));
  t.mock.method(Ticket, 'find', (filter) => chain([good, otherStaff, otherCompany, hidden].filter(sift(filter))));
  const result = await invoke(controller.allocationOptions, { params: { id: String(trip._id) }, query: { companyId: String(company), userId: ownId }, auth: { userId: ownId, isEndUser: false, can: ({taxi}) => taxi?.includes('allocate') } });
  assert.equal(result.error, undefined);
  assert.deepEqual(result.body.tickets.map((ticket) => String(ticket._id)), [String(good._id)]);
  trip.userId = null;
  assert.deepEqual((await invoke(controller.allocationOptions, { params: { id: String(trip._id) }, query: { companyId: String(company) }, auth: { userId: ownId, isEndUser: false, can: ({taxi}) => taxi?.includes('allocate') } })).body.tickets, []);
});

test('allocation cannot attach a newly selected ticket where the passenger is not responsible', async (t) => {
  const companyId = new Types.ObjectId(), ticketId = new Types.ObjectId();
  const trip = { _id: new Types.ObjectId(), userId: ownId, companyId, ticketIds: [] };
  const ticket = { _id: ticketId, company: { _id: companyId }, createdBy: ownId, responsibles: [] };
  t.mock.method(TaxiTrip, 'findById', () => chain(trip));
  t.mock.method(Company, 'exists', async () => true);
  t.mock.method(Ticket, 'find', () => Object.assign([ticket], { select: () => chain([]) }));
  t.mock.method(Work, 'find', () => chain([]));
  t.mock.method(TaxiTrip, 'findOneAndUpdate', () => assert.fail('invalid association must not be saved'));
  const result = await invoke(controller.allocate, { params: { id: String(trip._id) }, body: { companyId: String(companyId), ticketIds: [String(ticketId)], purpose: 'business' } });
  assert.equal(result.error?.statusCode, 400);
  assert.match(result.error?.message, /ответственный/);
});

test('report rows and totals both exclude deleted trips', async (t) => {
  const Preferences = require('../models/preferences');
  const matches = [];
  t.mock.method(Preferences, 'findOne', () => chain({ timezone: 'Asia/Vladivostok' }));
  t.mock.method(TaxiTrip, 'aggregate', async (pipeline) => { matches.push(pipeline[0].$match); return []; });
  t.mock.method(Company, 'find', () => chain([]));
  t.mock.method(User, 'find', () => chain([]));
  t.mock.method(TaxiSettings, 'findById', () => chain({ isActive: true }));
  const result = await invoke(controller.list, { auth: { userId: ownId, isEndUser: false, can: ({taxi}) => taxi?.includes('read') } });
  assert.equal(result.error, undefined);
  assert.equal(matches.length, 2);
  for (const filter of matches) assert.equal(filter.deletedAt, null);
});

test('detail returns the saved ride without provider requests or database mutations', async (t) => {
  const trip = { _id: new Types.ObjectId(), externalId: 'old-hd-order', clientId: 'corp', source: 'hd', userId: new Types.ObjectId(ownId), status: 'transporting', estimateMinor: 25000, driver: { name: 'Водитель' }, ticketIds: [], origin: { address: 'Россия, Приморский край, Владивосток, улица Толстого, 23', lat: 43, lon: 131 }, destination: { address: 'Приморский край, Владивосток, Пограничная улица, 15В', lat: 43.1, lon: 131.1 } };
  t.mock.method(TaxiTrip, 'findById', () => chain(trip));
  t.mock.method(TaxiTrip, 'findOneAndUpdate', () => assert.fail('read-only detail must not mutate a ride'));
  t.mock.method(require('../services/taxi/provider'), 'request', () => assert.fail('detail must read saved sync state'));
  t.mock.method(TaxiSettings, 'findById', () => assert.fail('detail must not require live configuration'));
  t.mock.method(Work, 'find', () => chain([]));
  t.mock.method(Company, 'find', () => chain([]));
  t.mock.method(User, 'find', () => chain([]));
  t.mock.method(TaxiEmployee, 'find', () => chain([]));
  const result = await invoke(controller.detail, { params: { id: String(trip._id) } });
  assert.equal(result.error, undefined);
  assert.deepEqual(Object.keys(result.body), ['trip']);
  assert.equal(result.body.trip.status, 'transporting');
  assert.equal(result.body.trip.source, 'hd');
  assert.equal(result.body.trip.estimateMinor, 25000);
  assert.deepEqual(result.body.trip.driver, trip.driver);
  assert.equal('canManage' in result.body.trip, false);
  assert.equal(result.body.trip.origin.address, 'Владивосток, улица Толстого, 23');
  assert.equal(result.body.trip.destination.address, 'Владивосток, Пограничная улица, 15В');
  assert.match(trip.origin.address, /^Россия,/);
  assert.equal(result.body.trip.origin.lat, trip.origin.lat);
});

test('taxi HTTP routes expose reporting and allocation without booking APIs', () => {
  const routes = require('../routes/internal/taxi').stack.filter((layer) => layer.route).map((layer) => ({ path: layer.route.path, methods: Object.keys(layer.route.methods) }));
  assert.deepEqual(routes.flatMap((route) => route.methods.map((method) => `${method.toUpperCase()} ${route.path}`)), [
    'GET /settings', 'PUT /settings', 'POST /check', 'POST /sync', 'PUT /employees/:externalId', 'GET /trips', 'POST /candidates',
    'GET /tickets/:id/trips', 'GET /tickets/:id/candidates', 'PATCH /trips/:id/allocation', 'GET /trips/:id/allocation-options', 'DELETE /trips/:id', 'GET /trips/:id',
  ]);
});
