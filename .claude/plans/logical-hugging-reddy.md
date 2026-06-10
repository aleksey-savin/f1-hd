# План: замена ссылок на helpdesk в Telegram на native inline-кнопки

## Контекст

В Telegram-сообщениях заявки содержат HTML-ссылки вида
`<a href='${ADDRESS}/tickets/${num}'>…</a>`, ведущие на веб-сайт helpdesk.
Цель — заменить эти ссылки на нативные inline-кнопки Telegram (`reply_markup.inline_keyboard`
с URL-кнопкой), чтобы переход на заявку выглядел как кнопка, а не как ссылка в тексте.

Источников ссылок два, и большинство — **не** в самом боте:

1. **Backend** (`backend/middleware/notifications.js`) формирует **17** Telegram-уведомлений
   (`instrument: "telegram"`) и зашивает ссылку прямо в `notification.text`. Бот лишь
   пересылает готовый текст через `tgSendMessage`.
2. **Сам бот** (`telegram-bot/middleware/tgBotApi.js`, обработчик `callback_query`) добавляет
   ссылку «Подробнее» в сообщение с деталями заявки (открывается из `/ticket_list`).

Решения пользователя: охват — **бот + backend (всё)**; текст кнопки — **«Подробнее»**.

## Подход

Backend остаётся «строителем» сообщения: он формирует inline-клавиатуру и сохраняет её в
уведомлении (новое поле `replyMarkup`). Бот остаётся «глупым» отправителем — просто
пробрасывает `replyMarkup` в `bot.sendMessage`. Это соответствует текущей архитектуре
(backend пишет `Notification`, бот их рассылает) и существующим inline-кнопкам в боте
(`tgBotApi.js:343, 378, 427, 468`).

URL-кнопка Telegram: `{ text: "Подробнее", url: \`${ADDRESS}/tickets/${num}\` }`.

## Изменения

### 1. Модели Notification — новое поле (обе, т.к. Mongoose strict mode отбрасывает неизвестные поля при чтении)

- `backend/models/notification.js`
- `telegram-bot/models/notification.js`

В обе схемы добавить:
```js
replyMarkup: { type: Schema.Types.Mixed },
```
Хранит готовую Telegram-разметку `{ inline_keyboard: [[…]] }`. Поле необязательное —
старые уведомления без него отправятся без кнопки (обратная совместимость, миграция не нужна).

### 2. Backend: `backend/middleware/notifications.js`

Добавить переиспользуемый помощник рядом с верхними утилитами файла:
```js
const ticketButton = (num) => ({
  inline_keyboard: [
    [{ text: "Подробнее", url: `${process.env.ADDRESS}/tickets/${num}` }],
  ],
});
```

Для всех **17** уведомлений с `instrument: "telegram"`, содержащих
`<a href='${process.env.ADDRESS}/tickets/${ticket.num}'>`:
1. Добавить рядом с `text:` поле `replyMarkup: ticketButton(ticket.num),`.
2. Убрать `<a …>`/`</a>` из текста по одному из двух шаблонов:

   - **Шаблон A — ссылка оборачивает заголовок** (оставляем `<b>…</b>`, убираем только обёртку `<a>`):
     `⭐️ <a href='…'><b>Новая заявка ${num}</b></a>\n…` → `⭐️ <b>Новая заявка ${num}</b>\n…`
     Строки: 125, 181, 321, 501, 589, 620, 798, 851, 978, 1006, 1217, 1243, 1274.

   - **Шаблон B — отдельная строка-ссылка «Подробнее»** (удаляем весь сегмент, его заменяет кнопка):
     `…\n<a href='…'><b>Подробнее</b></a>\n#ticket_${num}` → `…\n#ticket_${num}`
     Строки: 150, 409, 823, 1032.

Хэштеги `#ticket_${num}` (поиск в Telegram) и весь остальной текст сохраняются без изменений.

### 3. Telegram-bot: проброс кнопки в рассылке уведомлений

- `telegram-bot/controllers/telegramController.js:42` — передать третий аргумент:
  ```js
  const message = await tgSendMessage(
    notification.to.chatId,
    notification.text,
    notification.replyMarkup,
  );
  ```
- `telegram-bot/middleware/tgBotApi.js:569` (`tgSendMessage`) — принять `replyMarkup` и добавлять
  его в опции только при наличии:
  ```js
  exports.tgSendMessage = async (channelId, msg, replyMarkup) => {
    …
    const options = { disable_web_page_preview: true, parse_mode: "HTML" };
    if (replyMarkup) options.reply_markup = replyMarkup;
    const message = await bot.sendMessage(channelId, msg, options);
    …
  };
  ```

### 4. Telegram-bot: собственное сообщение бота (обработчик `callback_query`)

`telegram-bot/middleware/tgBotApi.js` (детали заявки, ~строки 505–535):
- В **обеих** ветках (`user.isEndUser` и не-клиент) убрать хвост
  `\n<a href='${process.env.ADDRESS}/tickets/${num}'><b>Подробнее</b></a>` из шаблона `message`.
- Телефонную ссылку `<a href='tel:${applicant.phone}'>` (ветка не-клиента) **оставить** — это не
  ссылка на сайт, и Telegram не разрешает `tel:` в URL-кнопках.
- В вызов `bot.sendMessage(...)` (строка ~529) добавить разметку:
  ```js
  await bot.sendMessage(ctx.message.chat.id, message, {
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [
        [{ text: "Подробнее", url: `${process.env.ADDRESS}/tickets/${num}` }],
      ],
    },
  });
  ```
  (`process.env.ADDRESS` уже используется в этом файле — строки 511, 526.)

## Вне охвата

- **Email-уведомления** — не трогаем (inline-кнопки только для Telegram); все ссылки в письмах остаются.
- **2 Telegram-уведомления о плановых работах** (`createScheduledWorkNotifications`, строки ~1755, 1867)
  — ссылки на заявку не содержат и могут перечислять несколько заявок, единая кнопка не подходит.
- **`tel:`-ссылка** на телефон инициатора — остаётся.

## Важные замечания

- **Деплой обоих сервисов вместе**: backend и telegram-bot используют общую коллекцию `Notification`;
  новое поле `replyMarkup` должно быть в схеме бота, иначе оно не прочитается.
- **Dev/localhost**: URL-кнопки требуют публичного `http(s)`-адреса. При `ADDRESS=http://localhost:3000`
  Telegram отклонит кнопку (`BUTTON_URL_INVALID`). В проде `ADDRESS` — реальный сайт, кнопки работают.
  Заметка: уведомления о заявках в dev и так не создаются (`notifications.js:41`), но уведомления о
  комментариях — создаются.

## Проверка

1. **Статически**: прогнать линтер в обоих сервисах (eslint-конфиги есть в `backend/` и `telegram-bot/`);
   grep подтверждает, что в telegram-текстах больше нет `href='…/tickets/…'`, а `#ticket_` остались.
2. **End-to-end** (с `ADDRESS` = публичный https-адрес, не localhost):
   - Создать заявку / добавить комментарий / закрыть заявку → backend пишет telegram-`Notification`
     с `replyMarkup`; бот отправляет сообщение с inline-кнопкой «Подробнее», нажатие открывает заявку.
   - В боте: `/ticket_list` → выбрать заявку → в деталях вместо текстовой ссылки видна inline-кнопка
     «Подробнее», нажатие открывает страницу заявки.
   - Проверить групповой чат (глобальные уведомления) — кнопки работают и в группах.
