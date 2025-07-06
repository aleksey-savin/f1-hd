//Блок документации

/*
Users - объект с пользователями
Places - объект с локациями
LocatorBot - главный объект с функционалом

Принцип работы:
 -LocatorBot запускается через функцию start
 -Бот спрашивает роль юзера, если юзер менеджер, то бот запоминает чат, иначе
 -Если юзер меняет свою геолокацию срабатывает функция checkLocation
 -Далее если бот уже спрашивает юзера о чём-то, то checkLocation завершает работу
 -Если нет, то происходит проверка каждой локации на расстояние от юзера и на наличие локации в исключениях
 -Если юзер не внутри локации, то мы спрашиваем, не зашёл ли он в новую локацию
 -Если же юзер внутри локации, то мы спрашиваем, не покинул ли он данную локацию
 -Бот ждёт ответа
 -Если ответ "да" на вопрос о входе в локацию, то срабатывает функция userEnteredLoc
 -Если ответ "да" на вопрос о выходе из локацию, то срабатывает функция userLeftLoc
 -Если ответ "нет" на любой из вопросов, то мы добавляем это место в исключения и какое-то время о нём не спрашиваем
 -Также пользователь может вручную выбрать локацию, в которой находиться, если ещё не внутри какой-либо локации
 -Или покинуть локацию вручную
*/

//TODO
// -Стоит переоформить команду /status

//Блок с константами
const { Telegraf, Markup } = require('telegraf');

const TOKEN = process.env.TG_LOCATION_BOT_TOKEN;
const bot = new Telegraf(TOKEN);

const STANDART_RADIUS = 0.15; //150 метров. Стандартный радиус локации
const EXCEPTION_DELAY = 5; //5 минут. Время, на которое бот перестанет повторно спрашивать о локации
const WAITING_FOR_ANSWER = 10; //10 минут. Время, которое бот будет ожидать ответ от юзера
const ALLOWED_TIMEOUT = 2; //2 минуты. Время, которое пользователь должен провести внутри локации, прежде чем бот спросит его
const MAX_DISTANCE = 0.35; //350 метров. Расстояние, на которое возможно уйти от локации, пока бот сам не решил, что пользователь вне локации

const Users = {
    //Объект с пользователями
    //collection - массив с объектами необходимового формата

    //Каждый юзер записывается в формате:
    //inside - название локации, в которой находится юзер
    //insideFor - сколько времени юзер провёл в локации в формате Date
    //exceptions - массив с локациями, добавленными в исключение (про такие локации бот не задаёт вопросов) в формате "place.title": Date
    //allowed - массив с локациями, в которых находиться юзер (нужно провести в них @ALLOWED_TIMEOUT минут, чтобы бот спросил про эту локацию) в формате "place.title": Date
    //askingFor - время, когда был задан текущий вопрос юзеру в формате Date
    //askingAbout - название локации, про которую был задан текущий вопрос

    //Функция add - добавляет в @collection объекты юзеров в необходимом формате

    collection: {},
    add: (userId, manager = false) => {
        Users.collection[userId] = {
            inside: null,
            insideFor: null,
            exceptions: {},
            allowed: {},
            askingFor: null,
            askingAbout: null,
            manager: manager,
        };
    },
};

const Places = {
    //Объект с локациями
    //collection - массив с объектами необходимового формата

    //Каждая локация записывается в формате:
    //latitude - широта локации
    //longitude - долгота локации
    //title - название локации
    //radius - радиус локации (по умолчанию равен @STANDART_RADIUS)

    //Функция add - добавляет в @collection объекты локаций в необходимом формате
    collection: [],
    add: (latitude, longitude, title, radius = STANDART_RADIUS) => {
        Places.collection.push({
            latitude: latitude,
            longitude: longitude,
            title: title,
            radius: radius,
        });
    },
};

//Массив с id чатов, в которые будет отправляться информация о перемещениях ИТ-Специалистов
const receiverChats = [];

//Блок с доьавлением локаций
// Places.add(43.120688, 131.909173, 'HOME1');
// Places.add(43.121566, 131.888362, "cool shop", 0.05);
// Places.add(43.121998, 131.907764, "HOME2");

Places.add(43.12188, 131.889204, "F1");

Places.add(43.123215, 131.88137, 'DVR');
Places.add(43.117958, 131.931155, 'AG Shilkinskaya');
Places.add(43.136703, 131.92775, 'AG Snegovaya');

Places.add(43.125117, 131.881388, 'Pony Express');
Places.add(43.116531, 131.888459, 'LG Electronics RUS');
Places.add(43.117273, 131.886949, 'Onduline');
Places.add(43.119543, 131.8865, 'TZ-Region');
Places.add(43.119543, 131.8865, 'PERC');

Places.add(43.123821, 131.887326, 'Trusova Notary');
Places.add(43.117589, 131.887632, 'Matyushenko Notary');
Places.add(43.111547, 131.917231, 'Gonchenko Notary');
Places.add(43.114667, 131.894513, 'Tenitskaya Notary');

Places.add(43.130677, 131.89003, 'Dalexpo');
Places.add(43.138348, 131.8978, 'DalGeoService');
Places.add(43.116531, 131.888459, 'Gavan Tourcentre');
Places.add(43.120794, 131.883709, 'ML-Best');
Places.add(43.166051, 131.927759, 'FBR21');

Places.add(43.130466, 131.890803, 'Syndicate Restaurant');
Places.add(43.116205, 131.881487, 'Studio Cafe');

Places.add(43.122518, 131.889033, 'Renta Vostok', 0.015);
Places.add(43.118023, 131.885071, 'KamInn');
Places.add(43.11974, 131.883991, 'Izba');
Places.add(43.10951, 131.878871, 'Teplo');
Places.add(43.108973, 131.878492, 'Lido Central');

const LocatorBot = {
    start: async () => {
        //Функция инициализирует бота, задаёт обработчики событий

        bot.start(async (ctx) => {
            await ctx.reply(
                `Перед тем как начать, мне необходимо узнать, кто вы.`,
                Markup.keyboard([[`Менеджер`, `ИТ-Специалист`]])
                    .oneTime()
                    .resize()
            );
        });

        bot.on('edited_message', (ctx) => {
            LocatorBot.checkLocation(ctx);
        });

        bot.hears('Менеджер', (ctx) => {
            LocatorBot.addRole(ctx, true);
        });

        bot.hears('ИТ-Специалист', (ctx) => {
            LocatorBot.addRole(ctx, false);
        });

        bot.hears(`Выбрать из списка локаций.`, (ctx) => {
            LocatorBot.showLocationList(ctx);
        });

        bot.hears(`Выйти из локации.`, (ctx) => {
            LocatorBot.manualLeftLoc(ctx);
        });

        bot.hears('✔️ Да', (ctx) => {
            LocatorBot.yesHandler(ctx);
        });

        bot.hears('❌ Нет', (ctx) => {
            LocatorBot.noHandler(ctx);
        });

        bot.hears('/status', (ctx) => {
            ctx.reply(JSON.stringify(Users.collection, null, 2));
        });

        //В цикле задаём обработчик для команд формата ~LocationTitle
        Places.collection.forEach(place => {
            bot.hears(`~${place.title}`, (ctx) => {
                LocatorBot.manualEnteredLoc(ctx, place.title);
            });
        });

        bot.launch();
    },
    addRole: async (ctx, manager) => {
        //Функция для назначения и изменения роли

        const userId = ctx.message.from.id;

        //Проверка на существование пользователя
        if (!Users.collection[userId]) {
            //Если пользователь не создан, то создаём и задаём ему нужную роль
            Users.add(userId, manager);
        } else {
            //Если пользователь уже создан, то меняем роль
            Users.collection[userId].manager = manager;
            ctx.reply(`Вы уже выбрали роль!`);
        }

        if (manager) {
            //Если пользователь выбрал роль менеджера и id чата ещё не было добавлено в список, то бот запомнит id этого чата
            if (!receiverChats.includes(ctx.message.chat.id))
                receiverChats.push(ctx.message.chat.id);

            bot.telegram.sendMessage(
                ctx.message.chat.id,
                `Бот будет отправлять информацию о перемещениях ИТ-Специалистов в данный чат.`
            );
        } else {
            //Если пользователь выбрал роль ИТ-специалиста, то бот предлагает выбрать из списка локаций
            return await ctx.reply(
                `Чтобы бот начал работать, отправьте ему свою live-геолокацию или выберите из списка локаций.`,
                Markup.keyboard([[`Выбрать из списка локаций.`]]).oneTime().resize()
            );
        }
    },
    checkLocation: (ctx) => {
        //Функция срабатывает при изменении сообщения

        const location = ctx.editedMessage.location;

        //Проверка на существование локации
        if (!location) return;

        //Данные пользователя
        const userId = ctx.editedMessage
            ? ctx.editedMessage.from.id
            : ctx.message.from.id;
        const userPosition = {
            latitude: location.latitude,
            longitude: location.longitude,
        };

        //Если пользователь с таким @userId не существует, то создаём новый
        if (!Users.collection[userId]) Users.add(userId);

        //Проверка на роль пользователя
        if (Users.collection[userId].manager) return;

        //Если мы уже спросили пользователя
        if (Users.collection[userId].askingFor) {
            //Если мы ждём ответ дольше @WAITING_FOR_ANSWER минут
            if (
                LocatorBot.timeSince(Users.collection[userId].askingFor) >
                WAITING_FOR_ANSWER * 1000 * 60
            ) {
                //Бот повторно задаёт вопрос
                Users.collection[userId].askingFor = null;
                Users.collection[userId].askingAbout = null;
            } else {
                return;
            }
        }

        //Цикл перебора локаций
        Places.collection.forEach(async (place) => {
            //Если данная локация находится в списке исключений
            if (Users.collection[userId].exceptions[place.title]) {
                if (
                    LocatorBot.timeSince(
                        Users.collection[userId].exceptions[place.title]
                    ) >
                    EXCEPTION_DELAY * 1000 * 60
                ) {
                    //Если время задержки истекло, то убираем исключение на данную локацию
                    Users.collection[userId].exceptions[place.title] = null;
                } else {
                    //Время задержки ещё не истекло
                    return;
                }
            }

            if (!Users.collection[userId].inside) {
                //Пользователь не внутри локации

                let distance = LocatorBot.calcDistance(userPosition, {
                    latitude: place.latitude,
                    longitude: place.longitude,
                });

                //Пользователь зашёл в локацию
                if (distance < place.radius) {
                    //Если бот ещё не запомнил, что юзер внутри этой локации, то запоминает
                    if (!Users.collection[userId].allowed[place.title]) {
                        Users.collection[userId].allowed[place.title] = new Date();
                    }

                    //Если пользователь находится в локации больше @ALLOWED_TIMEOUT минут, то спрашиваем его
                    if (LocatorBot.timeSince(Users.collection[userId].allowed[place.title]) > ALLOWED_TIMEOUT * 1000 * 60) {
                        LocatorBot.askEntering(userId, place, ctx);
                    }

                    return;
                }

                //Если пользователь фактически вне локации, а бот ещё думает, что внутри,
                //то бот запомнит, что пользователь вне этой локации
                Users.collection[userId].allowed[place.title] = null;

            } else if (place.title == Users.collection[userId].inside) {
                //Пользователь уже внутри локации

                let distance = LocatorBot.calcDistance(userPosition, {
                    latitude: place.latitude,
                    longitude: place.longitude,
                });

                //Пользователь вышел из локации на максимально допустимое расстояние
                if (distance > MAX_DISTANCE) {
                    //Информируем пользователя о том, что он вышел из локации на максимально допустимое расстояние
                    //и даём ему возможность выбрать из списка локаций
                    await ctx.reply(`Вы ушли из локации на максимально допустимое расстояние! С этого момента мы будем считать вас вне локации.`, Markup.keyboard([[`Выбрать из списка локаций.`]]).oneTime().resize());

                    LocatorBot.userLeftLoc(ctx, userId);
                }

                //Пользователь вышел из локации
                if (distance > place.radius) {
                    LocatorBot.askLeaving(userId, place, ctx);
                    return;
                }
            }
        });
    },
    showLocationList: async (ctx) => {
        //Функция срабатывает, когда мы просим бота показать список локаций

        //Данные пользователя
        const userId = ctx.editedMessage
            ? ctx.editedMessage.from.id
            : ctx.message.from.id;

        //Если пользователь с таким @userId не существует, то создаём новый
        if (!Users.collection[userId]) Users.add(userId);

        //Проверка на роль пользователя
        if (Users.collection[userId].manager) return;

        //Массив с названиями локаций для кнопки выбора локаций (в формате [строки[элементы в строке]])
        const placesTitles = [[]];

        //Количество строк и столбцов списка локаций
        let columns = 0;
        let rows = 0;

        //Считаем количество строк и столбцов в цикле
        Places.collection.forEach(place => {
            if (columns == 4) {
                //Если в строке уже 4 элемента, то мы создаём новую строку
                columns = 0;
                rows++;
                placesTitles[rows] = [];
            }
            placesTitles[rows].push(`~${place.title}`);
            columns++;
        });

        //Бот выводит список локаций
        return await ctx.reply(`Список локаций:`, Markup.keyboard(placesTitles).oneTime().resize());
    },
    manualEnteredLoc: async (ctx, locationTitle) => {
        //Функция срабатывает, когда пользователь вручную задаёт локацию, в которой находится

        let location = null;

        //Поиск локации с таким названием для последующей проверки
        Places.collection.forEach((place) => {
            if (place.title == locationTitle) location = place;
        });

        //Проверка на существование локации
        if (!location) return;

        //Данные пользователя
        const userId = ctx.editedMessage
            ? ctx.editedMessage.from.id
            : ctx.message.from.id;

        //Если пользователь с таким @userId не существует, то создаём новый
        if (!Users.collection[userId]) Users.add(userId);

        //Проверка на роль пользователя
        if (Users.collection[userId].manager) return;

        //Если пользователь уже где-то находится, то бот не сможет поместить его куда-то ещё
        if (Users.collection[userId].inside) return;

        //Если мы уже спросили пользователя
        if (Users.collection[userId].askingFor) {
            //Если мы ждём ответ дольше @WAITING_FOR_ANSWER минут
            if (
                LocatorBot.timeSince(Users.collection[userId].askingFor) >
                WAITING_FOR_ANSWER * 1000 * 60
            ) {
                //Бот повторно задаёт вопрос
                Users.collection[userId].askingFor = null;
                Users.collection[userId].askingAbout = null;
            } else {
                return ctx.reply(`Бот ещё ждёт вашего ответа!`);
            }
        }

        //Убираем данную локацию из списка исключений
        Users.collection[userId].exceptions[location.title] = null;

        //Пользователь зашёл в локацию
        Users.collection[userId].inside = location.title;
        Users.collection[userId].insideFor = new Date();

        //Бот отправляет сообщения о событии во все чаты менеджеров
        const userName = (await bot.telegram.getChat(userId)).username;
        LocatorBot.sendInfoToReceiverChats(
            `@${userName} зашёл в локацию ${Users.collection[userId].inside}.`
        );

        //Информируем пользователя о том, что он зашёл в локацию и даём ему возможность покинуть локацию вручную
        ctx.reply(`Вы зашли в локацию ${Users.collection[userId].inside}.`, Markup.keyboard([[`Выйти из локации.`]]).oneTime().resize());
    },
    manualLeftLoc: async (ctx) => {
        //Функция срабатывает, когда пользователь вручную уходит из локации, в которой находился

        //Данные пользователя
        const userId = ctx.editedMessage
            ? ctx.editedMessage.from.id
            : ctx.message.from.id;

        //Проверка на существование пользователя
        if (!Users.collection[userId]) return;

        //Проверка на роль пользователя
        if (Users.collection[userId].manager) return;

        //Если пользователь вне локации, то он и не сможет убрать пользователь откуда-либо
        if (!Users.collection[userId].inside) return;

        //Если мы уже спросили пользователя
        if (Users.collection[userId].askingFor) {
            //Если мы ждём ответ дольше @WAITING_FOR_ANSWER минут
            if (
                LocatorBot.timeSince(Users.collection[userId].askingFor) >
                WAITING_FOR_ANSWER * 1000 * 60
            ) {
                //Бот повторно задаёт вопрос
                Users.collection[userId].askingFor = null;
                Users.collection[userId].askingAbout = null;
            } else {
                return ctx.reply(`Бот ещё ждёт вашего ответа!`);
            }
        }

        //Информируем пользователя о том, что он вышел из локации и даём ему возможность выбрать из списка локаций
        await ctx.reply(`Вы успешно вышли из локации.`, Markup.keyboard([[`Выбрать из списка локаций.`]]).oneTime().resize());

        //Далее срабатывает обычное поведение бота, когда пользователь покидает локацию
        LocatorBot.userLeftLoc(ctx, userId);
    },
    yesHandler: (ctx) => {
        //Обработчик, который срабатывает, когда юзер отправляет сообщение "✔️ Да"

        const userId = ctx.message.from.id;

        //Проверка на существование пользователя
        if (!Users.collection[userId]) return;

        //Проверка на роль пользователя
        if (Users.collection[userId].manager) return;

        //Проверка на наличие вопроса (чтобы юзер не мог сломать бота, просто отправив сообщение)
        if (!Users.collection[userId].askingAbout) return;

        if (!Users.collection[userId].inside) {
            //Юзер вошёл в локацию
            LocatorBot.userEnteredLoc(ctx, userId);
        } else {
            //Юзер вышел из локации
            LocatorBot.userLeftLoc(ctx, userId);
        }

        Users.collection[userId].askingFor = null;
        Users.collection[userId].askingAbout = null;
    },
    userEnteredLoc: async (ctx, userId) => {
        Users.collection[userId].inside = Users.collection[userId].askingAbout;
        Users.collection[userId].insideFor = new Date();

        //Бот отправляет сообщения о событии во все чаты менеджеров
        const userName = (await bot.telegram.getChat(ctx.message.from.id))
            .username;
        LocatorBot.sendInfoToReceiverChats(
            `@${userName} зашёл в локацию ${Users.collection[userId].inside}.`
        );

        //Даём пользователю возможность покинуть локацию вручную
        ctx.reply('Окей, принято.', Markup.keyboard([[`Выйти из локации.`]]).oneTime().resize());
    },
    userLeftLoc: async (ctx, userId) => {
        const wasInside = LocatorBot.timeSince(
            Users.collection[userId].insideFor
        );

        //Бот отправляет сообщения о событии во все чаты менеджеров
        const userName = (await bot.telegram.getChat(ctx.message.from.id)).username;
        LocatorBot.sendInfoToReceiverChats(
            `@${userName} покинул локацию ${Users.collection[userId].inside}.`
        );

        ctx.reply(
            `Вы провели в ${Users.collection[userId].inside
            } ${LocatorBot.timeFormatter(wasInside)}.`
        );

        Users.collection[userId].inside = null;
        Users.collection[userId].insideFor = null;
    },
    noHandler: async (ctx) => {
        //Обработчик, который срабатывает, когда юзер отправляет сообщение "❌ Нет"

        const userId = ctx.message.from.id;

        //Проверка на существование пользователя
        if (!Users.collection[userId]) return;

        //Проверка на роль пользователя
        if (Users.collection[userId].manager) return;

        //Проверка на наличие вопроса (чтобы юзер не мог сломать бота, просто отправив сообщение)
        if (!Users.collection[userId].askingAbout) return;

        //Запись локации в список исключений
        Users.collection[userId].exceptions[
            Users.collection[userId].askingAbout
        ] = new Date();

        Users.collection[userId].askingAbout = null;
        Users.collection[userId].askingFor = null;

        ctx.reply(
            `Тогда не будем вас беспокоить ещё ${LocatorBot.timeFormatter(
                EXCEPTION_DELAY * 1000 * 60
            )}`
        );
    },
    askEntering: async (userId, place, ctx) => {
        //Функция задаёт вопрос юзеру о входе в локацию и запоминает, что она задала вопрос

        Users.collection[userId].askingFor = new Date();
        Users.collection[userId].askingAbout = place.title;

        return await ctx.reply(
            `Кажется, вы сейчас в ${place.title}. Так ли это?`,
            Markup.keyboard([['✔️ Да', '❌ Нет']])
                .oneTime()
                .resize()
        );
    },
    askLeaving: async (userId, place, ctx) => {
        //Функция задаёт вопрос юзеру о выходе из локации и запоминает, что она задала вопрос

        Users.collection[userId].askingFor = new Date();
        Users.collection[userId].askingAbout = place.title;

        return await ctx.reply(
            `Кажется, вы покинули ${place.title}. Так ли это?`,
            Markup.keyboard([['✔️ Да', '❌ Нет']])
                .oneTime()
                .resize()
        );
    },
    sendInfoToReceiverChats: async (message) => {
        receiverChats.forEach((chat) => {
            bot.telegram.sendMessage(chat, message);
        });
    },
    calcDistance: (placeA, placeB) => {
        //Вспомогательная функций, считающая
        //дистанцию в метрах по двум координатам

        let newPlaceA = {};
        let newPlaceB = {};

        newPlaceA.latitude = (placeA.latitude * Math.PI) / 180;
        newPlaceA.longitude = (placeA.longitude * Math.PI) / 180;

        newPlaceB.latitude = (placeB.latitude * Math.PI) / 180;
        newPlaceB.longitude = (placeB.longitude * Math.PI) / 180;

        const R = 6371;

        let distance =
            2 *
            R *
            Math.asin(
                Math.sqrt(
                    Math.pow(
                        Math.sin((newPlaceB.latitude - newPlaceA.latitude) / 2),
                        2
                    ) +
                    Math.cos(newPlaceA.latitude) *
                    Math.cos(newPlaceB.latitude) *
                    Math.pow(
                        Math.sin(
                            (newPlaceB.longitude -
                                newPlaceA.longitude) /
                            2
                        ),
                        2
                    )
                )
            );

        return distance;
    },
    timeFormatter: (millisecs) => {
        //Вспомогательная функция, конвертирующая
        //миллисекунды (number) в string формата 10 ч. 10 мин.

        let minutes = millisecs / 1000 / 60;

        let msgHours = ' ч. ';
        let msgMinutes = ' мин.';

        let hours = Math.floor(minutes / 60);

        msgMinutes = Math.round(minutes % 60) + msgMinutes;

        if (hours > 0) {
            msgHours = hours + msgHours;
        } else {
            msgHours = '';
        }

        return msgHours + msgMinutes;
    },
    timeSince: (prevDate) => {
        return new Date().getTime() - prevDate.getTime();
    },
};

module.exports.LocatorBot = LocatorBot;
