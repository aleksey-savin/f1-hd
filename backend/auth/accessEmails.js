const { resolveBrand, escapeHtml } = require("@/services/brand");

/**
 * Тексты писем о доступе: приглашение, восстановление, ссылка и код.
 *
 * Чистые функции без базы и отправки: на вход — настройки и данные письма, на
 * выход — `{ title, body }`. Подпись сюда не входит, её дописывает отправка
 * (auth/hooks.js) — она общая у всех писем.
 *
 * В письмах ДВА названия, и путать их нельзя: в теме — название ПОРТАЛА
 * (`brand.productName`), в тексте — название ОРГАНИЗАЦИИ (`contacts.title`),
 * чей это портал поддержки. Организация может быть не задана; тогда фраза
 * обходится без неё.
 */

/** Обращение по имени; пустое — «Здравствуйте», а не голая запятая. */
const greet = (user) => user?.firstName || user?.name || "Здравствуйте";

const CODE_STYLE = "font-size: 1.6em; letter-spacing: 0.25em; font-weight: bold;";

// Тема — простой текст, не HTML: не экранируется, но перевод строки в ней
// стал бы новым заголовком письма
const subject = (value) => value.replace(/[\r\n]+/g, " ").trim();

const names = (preferences) => {
  const organisation =
    typeof preferences?.contacts?.title === "string"
      ? preferences.contacts.title.trim()
      : "";
  return {
    productName: resolveBrand(preferences).productName,
    // «в портале поддержки Ромашки» или просто «в портале поддержки»
    supportPortal: organisation
      ? `в портале поддержки ${escapeHtml(organisation)}`
      : "в портале поддержки",
  };
};

/** Приглашение со ссылкой на задание пароля. */
const passwordInvitation = ({ preferences, user, url }) => {
  const { productName, supportPortal } = names(preferences);
  return {
    title: subject(`Вам открыт доступ в портал ${productName}`),
    body: `
        <p>${greet(user)},</p>
        <p>для вас создана учётная запись ${supportPortal} — через него
          отправляют заявки и следят за их выполнением.</p>
        <p><a href="${url}" target="_blank">Задайте пароль</a> — после этого
          входите по нему и рабочей почте.</p>
        <p>Ссылка действительна сутки и срабатывает один раз.</p>
      `,
  };
};

/** Восстановление пароля по ссылке. */
const passwordReset = ({ preferences, user, url }) => ({
  title: subject(
    `Восстановление доступа к порталу ${names(preferences).productName}`,
  ),
  body: `
      <p>${greet(user)},</p>
      <p>сбросить пароль можно пройдя по <a href="${url}" target="_blank">ссылке</a>.</p>
      <p>Ссылка действительна 24 часа и срабатывает один раз.</p>
      <p>Если вы не запрашивали смену пароля, просто проигнорируйте это письмо.</p>
    `,
});

/** Приглашение со ссылкой для входа без пароля. */
const linkInvitation = ({ preferences, user, url }) => {
  const { productName, supportPortal } = names(preferences);
  return {
    title: subject(`Вам открыт доступ в портал ${productName}`),
    body: `
        <p>${greet(user)},</p>
        <p>для вас создана учётная запись ${supportPortal} — через него
          вы отправляете заявки и видите, что с ними происходит.</p>
        <p><a href="${url}" target="_blank">Войти в портал</a> — пароль не
          понадобится.</p>
        <p>Ссылка действительна двое суток и срабатывает один раз. Если она
          истечёт, на странице входа нажмите «Войти по коду из письма» — код
          придёт сюда же.</p>
      `,
  };
};

/** Ссылка для входа. */
const signInLink = ({ preferences, user, url }) => ({
  title: subject(`Вход в портал ${names(preferences).productName}`),
  body: `
      <p>${greet(user)},</p>
      <p>войти в портал можно по <a href="${url}" target="_blank">этой ссылке</a> —
        пароль не понадобится.</p>
      <p>Ссылка действительна 30 минут и срабатывает один раз.</p>
      <p>Если вы её не запрашивали, просто проигнорируйте это письмо: без
        перехода по ссылке ничего не произойдёт.</p>
    `,
});

/** Код для входа (клиенту). */
const signInCode = ({ preferences, user, otp, minutes }) => ({
  title: subject(`Код для входа в портал ${names(preferences).productName}`),
  body: `
        <p>${greet(user)},</p>
        <p>ваш код для входа в портал:</p>
        <p style="${CODE_STYLE}">${otp}</p>
        <p>Введите его на странице входа — пароль не понадобится. Код
          действителен ${minutes} минут и срабатывает один раз.</p>
        <p>Если вы его не запрашивали, просто проигнорируйте это письмо: без
          кода ничего не произойдёт.</p>
      `,
});

/** Код для смены пароля (сотруднику). */
const passwordCode = ({ preferences, user, otp, minutes }) => ({
  title: subject(
    `Код для смены пароля в портале ${names(preferences).productName}`,
  ),
  body: `
        <p>${greet(user)},</p>
        <p>ваш код для смены пароля:</p>
        <p style="${CODE_STYLE}">${otp}</p>
        <p>Введите его на странице входа и задайте новый пароль. Код
          действителен ${minutes} минут и срабатывает один раз.</p>
        <p>Если вы его не запрашивали, просто проигнорируйте это письмо: без
          кода пароль не изменится.</p>
      `,
});

module.exports = {
  passwordInvitation,
  passwordReset,
  linkInvitation,
  signInLink,
  signInCode,
  passwordCode,
};
