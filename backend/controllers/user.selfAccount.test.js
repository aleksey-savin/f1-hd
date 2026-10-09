// node --test controllers/user.selfAccount.test.js
require("module-alias/register");
const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

// Базы нет: запрос, который забыли подменить, должен падать сразу, а не висеть
// в буфере до первого подключения
mongoose.set("bufferCommands", false);

const User = require("@/models/user");
const controller = require("./user");

/**
 * «Мой аккаунт» (`POST /api/users/update-account`) защищён одним `isAuth`.
 * Email — это вход (S6), categories — разделы базы знаний, открытые человеку
 * (S18): ни то ни другое из своего профиля менять нельзя. Тест помощника
 * (services/selfAccountFields.test.js) не заметит, что из контроллера пропал
 * ЕГО ВЫЗОВ — например, откат куска файла при слиянии, — поэтому здесь
 * исполняется настоящий `updateMyAccount`.
 *
 * Документ — `User.hydrate`: настоящий экземпляр модели «как из базы», на нём
 * работают strict mode и сеттеры (email приводится к нижнему регистру, телефон
 * — к цифрам). `new User({...})` пометил бы изменёнными все пути конструктора,
 * и `modifiedPaths()` перестал бы показывать, что тронул контроллер. Подменены
 * только `User.findById` и `save` документа: save не пишет в базу, а запоминает,
 * ЧТО было бы записано (`modifiedPaths()` на момент вызова).
 */

const objectId = (hex) => new mongoose.Types.ObjectId(hex);

const OWN_ID = "66aa00000000000000000001";
const OWN_SECTION = "66aa00000000000000000011";
const OWN_COMPANY = "66aa00000000000000000021";
const OTHER_ID = "66aa000000000000000000a1";
const OTHER_SECTION = "66aa00000000000000000091";
const OTHER_COMPANY = "66aa00000000000000000092";

// Сотрудник без админских прав и без привязки телеграма: «отвязка» из тела на
// нём ничего не меняет, поэтому в modifiedPaths() остаётся только то, что
// человек правит сам
const person = () =>
  User.hydrate({
    _id: objectId(OWN_ID),
    email: "maria@example.com",
    firstName: "Мария",
    lastName: "Иванова",
    phone: "79145550142",
    position: "Инженер поддержки",
    categories: [{ _id: objectId(OWN_SECTION), title: "Сети" }],
    isAdmin: false,
    isEndUser: false,
    role: "user",
    banned: false,
    company: { _id: objectId(OWN_COMPANY), alias: "F1", isActive: true },
    telegramBot: { isActive: false, chatId: "", linkedAt: null },
  });

const sectionIds = (user) =>
  user.categories.map((section) => String(section._id));

const originalFindById = User.findById;

afterEach(() => {
  User.findById = originalFindById;
});

/**
 * Зовёт настоящий контроллер с сеансом человека `user`. `written` — снимки
 * `modifiedPaths()` на каждый save(): ровно то, что ушло бы в базу. save
 * подменён на самом документе, а документ свой в каждом тесте, поэтому
 * восстанавливать нечего. Документ отдаётся только по id из сеанса: если
 * контроллер начнёт искать по id из тела, ответом будет 404.
 */
const updateAccount = async (user, body) => {
  const written = [];
  user.save = async function save() {
    written.push(this.modifiedPaths());
    return this;
  };
  User.findById = async (id) => (String(id) === String(user._id) ? user : null);

  const res = {
    statusCode: null,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
  const errors = [];

  await controller.updateMyAccount(
    { userId: String(user._id), body },
    res,
    (error) => errors.push(error),
  );

  return { res, errors, written };
};

// Ответ 201 без ошибки; при падении показываем исходную ошибку, а не только 500
const assertCreated = ({ res, errors }) => {
  assert.equal(
    errors.length,
    0,
    errors[0]?.originalError?.stack ?? errors[0]?.message,
  );
  assert.equal(res.statusCode, 201);
};

test("a hostile body changes only the profile fields", async () => {
  const user = person();
  const outcome = await updateAccount(user, {
    firstName: "Анна",
    id: OTHER_ID,
    email: "evil@example.com",
    categories: [{ _id: OTHER_SECTION, title: "Чужой раздел" }],
    isAdmin: true,
    role: "impersonator",
    company: { _id: OTHER_COMPANY, alias: "Чужая компания" },
    banned: true,
    isEndUser: true,
    telegramBot: { chatId: "999999", isActive: true },
  });

  assertCreated(outcome);
  // В базу ушла ровно одна правка — имя, и она применена
  assert.deepEqual(outcome.written, [["firstName"]]);
  assert.equal(user.firstName, "Анна");

  // Вход и доступ остались прежними
  assert.equal(user.email, "maria@example.com");
  assert.deepEqual(sectionIds(user), [OWN_SECTION]);
  assert.equal(user.isAdmin, false);
  assert.equal(user.role, "user");
  assert.equal(String(user.company._id), OWN_COMPANY);
  assert.equal(user.banned, false);
  assert.equal(user.isEndUser, false);

  // Чужой chatId не принят: привязку из тела не поставить, только снять
  assert.equal(user.telegramBot.chatId, "");
  assert.equal(user.telegramBot.isActive, false);
});

test("a body with only e-mail and categories modifies nothing", async () => {
  const user = person();
  const outcome = await updateAccount(user, {
    email: "evil@example.com",
    categories: [{ _id: OTHER_SECTION, title: "Чужой раздел" }],
  });

  assertCreated(outcome);
  assert.deepEqual(outcome.written, [[]]);
  assert.equal(user.email, "maria@example.com");
  assert.deepEqual(sectionIds(user), [OWN_SECTION]);

  // Ответ по-прежнему отдаёт их — как данные только для чтения
  assert.equal(outcome.res.payload.user.email, "maria@example.com");
  assert.deepEqual(
    outcome.res.payload.user.categories.map((section) => String(section._id)),
    [OWN_SECTION],
  );
});

test("an absent body is a no-op, not a 500", async () => {
  const user = person();
  const outcome = await updateAccount(user, undefined);

  assertCreated(outcome);
  assert.deepEqual(outcome.written, [[]]);
  assert.equal(user.firstName, "Мария");
  assert.equal(user.email, "maria@example.com");
});
