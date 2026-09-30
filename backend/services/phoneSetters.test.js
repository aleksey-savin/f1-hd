// node --test services/phoneSetters.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");

// Настоящие модели, без базы: документы собираются в памяти, запросы только
// приводятся к схеме (cast) — ровно то, что Mongoose делает перед отправкой
const User = require("@/models/user");
const Company = require("@/models/company");
const Subdivision = require("@/models/subdivision");
const Supplier = require("@/models/inventory/supplier");
const RoutineTask = require("@/models/routineTask");
const { Ticket } = require("@/models/ticket");
const Preferences = require("@/models/preferences");
const Channel = require("@/models/channel");
const ChannelIdentity = require("@/models/channelIdentity");

const RAW = "+7 (914) 555-01-42";
const CANON = "79145550142";

test("every stored phone path keeps canonical digits", () => {
  assert.equal(new User({ phone: RAW }).phone, CANON);
  assert.equal(new Subdivision({ phone: RAW }).phone, CANON);
  assert.equal(new Supplier({ phone: RAW }).phone, CANON);
  assert.equal(new Preferences({ contacts: { tel: RAW } }).contacts.tel, CANON);
  assert.equal(new Channel({ account: { phone: RAW } }).account.phone, CANON);
  assert.equal(new ChannelIdentity({ phone: RAW }).phone, CANON);

  const company = new Company({
    phones: [RAW, "8 (423) 222-29-99"],
    users: [{ phone: RAW }],
    responsibles: [{ phone: RAW }],
    clientsSideResponsibles: [{ phone: RAW }],
  });
  assert.deepEqual([...company.phones], [CANON, "74232222999"]);
  assert.equal(company.users[0].phone, CANON);
  assert.equal(company.responsibles[0].phone, CANON);
  assert.equal(company.clientsSideResponsibles[0].phone, CANON);

  const ticket = new Ticket({ applicant: { phone: RAW }, responsibles: [{ phone: RAW }] });
  assert.equal(ticket.applicant.phone, CANON);
  assert.equal(ticket.responsibles[0].phone, CANON);
  assert.equal(new RoutineTask({ responsibles: [{ phone: RAW }] }).responsibles[0].phone, CANON);
});

test("a pushed company phone is normalized too", () => {
  const company = new Company({ phones: [] });
  company.phones.push(RAW);
  assert.deepEqual([...company.phones], [CANON]);
});

test("stored digits are copied as they are", () => {
  // Немецкий номер в снимке не должен стать «74930901820»
  assert.equal(new Ticket({ responsibles: [{ phone: "4930901820" }] }).responsibles[0].phone, "4930901820");
});

test("query filters are normalized, regular expressions pass through", () => {
  const byPhone = User.find({ phone: RAW });
  byPhone.cast(User);
  assert.deepEqual(byPhone.getFilter(), { phone: CANON });

  const byCompanyPhone = Company.find({ phones: RAW });
  byCompanyPhone.cast(Company);
  assert.deepEqual(byCompanyPhone.getFilter(), { phones: CANON });

  const byPattern = User.find({ phone: /914/ });
  byPattern.cast(User);
  assert.ok(byPattern.getFilter().phone instanceof RegExp);
});

test("updates are normalized before they reach the database", () => {
  // _castUpdate — шаг Mongoose перед отправкой обновления; зовём его напрямую,
  // потому что базы в тесте нет
  const update = User.findOneAndUpdate({}, { $set: { phone: RAW } });
  assert.deepEqual(update._castUpdate(update._update), { $set: { phone: CANON } });

  const account = Channel.updateOne({}, { $set: { account: { phone: RAW } } });
  assert.equal(account._castUpdate(account._update).$set.account.phone, CANON);

  const identity = ChannelIdentity.findOneAndUpdate({}, { $set: { phone: RAW } });
  assert.equal(identity._castUpdate(identity._update).$set.phone, CANON);
});

test("array updates are normalized too", () => {
  // Номера компании и снимки людей правят и операторами массивов — тот же
  // _castUpdate, что выше
  const push = Company.updateOne({}, { $push: { phones: RAW } });
  assert.deepEqual(push._castUpdate(push._update), { $push: { phones: CANON } });

  const pushEach = Company.updateOne({}, { $push: { phones: { $each: [RAW, "8 (423) 222-29-99"] } } });
  assert.deepEqual(pushEach._castUpdate(pushEach._update), {
    $push: { phones: { $each: [CANON, "74232222999"] } },
  });

  const addToSet = Company.updateOne({}, { $addToSet: { phones: RAW } });
  assert.deepEqual(addToSet._castUpdate(addToSet._update), { $addToSet: { phones: CANON } });

  const byIndex = Company.updateOne({}, { $set: { "phones.0": RAW } });
  assert.deepEqual(byIndex._castUpdate(byIndex._update), { $set: { "phones.0": CANON } });

  const positional = Company.updateOne({}, { $set: { "responsibles.$.phone": RAW } });
  assert.deepEqual(positional._castUpdate(positional._update), {
    $set: { "responsibles.$.phone": CANON },
  });

  const pull = Company.updateOne({}, { $pull: { phones: RAW } });
  assert.deepEqual(pull._castUpdate(pull._update), { $pull: { phones: CANON } });
});
