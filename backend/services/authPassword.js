const mongoose = require("mongoose");

const { getAuth } = require("@/auth/bootstrap");

/**
 * Единственная точка, где приложение само задаёт пароль пользователю.
 *
 * Нужна там, где сессии ещё нет и ручки better-auth недоступны: заведение
 * пользователя администратором, сид при первом старте, админский сброс. Всё
 * остальное — смена своего пароля и восстановление по почте — делают ручки
 * better-auth напрямую, и сюда не заходит.
 *
 * Хеширование ШТАТНОЕ (scrypt better-auth). Унаследованные bcrypt-хеши живут
 * дальше только у тех, кто пароль не менял: функция проверки распознаёт их по
 * префиксу `$2` (см. auth/instance.mjs). Всё, что задано после переезда, —
 * scrypt.
 *
 * Пароль пишется в `authAccounts` (источник истины для better-auth) и тем же
 * значением в `users.password`: поле объявлено `required` в схеме, а
 * дублирование одного и того же хеша безопаснее, чем два разных. Само поле
 * `users.password` уходит в уборке — читать его больше некому.
 */
class PasswordPolicyError extends Error {
  constructor(message) {
    super(message);
    this.name = "PasswordPolicyError";
    this.statusCode = 400;
  }
}

/**
 * Требования к паролю берём у самой библиотеки (`ctx.password.config`), а не
 * дублируем числом в контроллерах. Своя константа уже один раз разошлась: в
 * админском сбросе стояло «не короче 6» от прежнего кода, и пароль `123456`
 * проходил мимо штатного минимума better-auth в 8 символов.
 */
const assertPolicy = (ctx, plainPassword) => {
  const { minPasswordLength, maxPasswordLength } = ctx.password.config;
  const length = String(plainPassword || "").length;

  if (length < minPasswordLength) {
    throw new PasswordPolicyError(
      `Минимальная длина пароля — ${minPasswordLength} символов`,
    );
  }
  if (length > maxPasswordLength) {
    throw new PasswordPolicyError(
      `Максимальная длина пароля — ${maxPasswordLength} символов`,
    );
  }
};

const setUserPassword = async (userId, plainPassword) => {
  const ctx = await getAuth().$context;
  const id = String(userId);

  assertPolicy(ctx, plainPassword);

  // Хук better-auth висит на ЕГО маршрутах и до прикладного кода не достаёт —
  // проверяем сами тем же вызовом, иначе пароль, заданный администратором,
  // обошёл бы блок-лист, а заданный самим человеком — нет.
  const { checkBreached, breachMessage } = require("@/services/passwordPolicy");
  const breach = await checkBreached(plainPassword);
  if (breach.breached) {
    throw new PasswordPolicyError(breachMessage(breach.count));
  }

  const hash = await ctx.password.hash(plainPassword);

  const accounts = (await ctx.internalAdapter.findAccounts(id)) || [];
  const credential = accounts.find(
    (account) => account.providerId === "credential",
  );

  if (credential) {
    await ctx.internalAdapter.updateAccount(credential.id, { password: hash });
  } else {
    await ctx.internalAdapter.createAccount({
      userId: id,
      accountId: id,
      providerId: "credential",
      password: hash,
    });
  }

  // Нативным драйвером, а не через save(): на легаси-документах полная
  // валидация упала бы на полях, к паролю отношения не имеющих.
  await mongoose.connection.db
    .collection("users")
    .updateOne(
      { _id: new mongoose.Types.ObjectId(id) },
      { $set: { password: hash } },
    );

  return hash;
};

/**
 * Проверка пароля БЕЗ создания сеанса.
 *
 * Нужна именно так, потому что наши основания для отказа шире, чем у
 * better-auth: он не знает ни про служебные учётки, ни про отключённые, ни про
 * отключённую компанию. Пока проверка пароля совмещалась с созданием сеанса
 * (`signInEmail` за один вызов делает и то, и другое), отклонённый нами вход
 * всё равно оставлял в базе живую строку сеанса и отдавал клиенту рабочую
 * cookie: прикладные ручки её отбивали (`attachSession` перепроверяет
 * `isActive`), но всё, что better-auth обслуживает сам — `get-session`, смена
 * пароля, список и отзыв сеансов, дальше 2FA, — отключённой учётке было
 * открыто.
 *
 * Второе применение — смена своего пароля: она обязана спросить текущий,
 * иначе увёденная сессия меняет пароль и запирает хозяина снаружи.
 *
 * Хеш берём из credential-аккаунта и сверяем штатной функцией better-auth — тем
 * же кодом, что и штатный вход, включая распознавание унаследованных
 * bcrypt-хешей по префиксу `$2`.
 */
const verifyUserPassword = async (userId, plainPassword) => {
  if (!plainPassword) return false;

  const ctx = await getAuth().$context;
  const accounts =
    (await ctx.internalAdapter.findAccounts(String(userId))) || [];
  const credential = accounts.find(
    (account) => account.providerId === "credential" && account.password,
  );

  if (!credential) return false;

  // Только `ctx.password.verify` — в контексте лежит наша
  // `verifyWithLegacyBcrypt` (`create-context.mjs`: `verify:
  // options.emailAndPassword?.password?.verify || verifyPassword`), которая
  // распознаёт унаследованные `$2a$`/`$2b$`. Сырая функция better-auth —
  // чистый scrypt и на bcrypt-хеше БРОСАЕТ «Invalid password hash»: вход
  // ломался ровно у тех, кто пароль ни разу не менял, то есть у всех живых
  // учёток, а на пробных (заведённых через `setUserPassword`, уже scrypt) всё
  // проходило. Наружу она больше не экспортируется вовсе.
  return ctx.password.verify({
    hash: credential.password,
    password: plainPassword,
  });
};

module.exports = { setUserPassword, verifyUserPassword, PasswordPolicyError };
