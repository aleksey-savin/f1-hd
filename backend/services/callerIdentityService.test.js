// node --test services/callerIdentityService.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");

const {
  extractCallerPhones,
  onlyOne,
  findByAnyPhone,
  findUsersByPhone,
  findApplicantByPhone,
  findCompanyByPhone,
  extractEmail,
} = require("./callerIdentityService");

test("the «Кто звонил» number is the only candidate when present", () => {
  // «Номер линии» — наш собственный номер, рядом лежит время звонка: ни то ни
  // другое звонящим быть не может
  assert.deepEqual(
    extractCallerPhones({
      description:
        "Номер линии: 8 (423) 222-29-99\nКто звонил: +7 914 555-01-42\nВремя звонка: 30-09-2026 12:00:00",
    }),
    ["79145550142"],
  );
  assert.deepEqual(
    extractCallerPhones({
      name: "Входящий звонок 8 (423) 222-29-99",
      description: "Кто звонил: +7 914 555-01-42\nС кем говорил: Иванов",
    }),
    ["79145550142"],
  );
});

test("without the marker: the subject, then the body", () => {
  assert.deepEqual(
    extractCallerPhones({
      name: "Входящий звонок 8 (423) 222-29-99",
      description: "тел. 8 (914) 555-01-42",
    }),
    ["74232222999", "79145550142"],
  );
});

test("a withheld caller ID matches nobody", () => {
  // Метка есть, номера при ней нет — звонящий скрыт. Номер линии (наш) и тема
  // не он: без запасных номеров скрытый звонок не достаётся их владельцам
  assert.deepEqual(
    extractCallerPhones({
      name: "Входящий звонок 8 (423) 222-29-99",
      description: "Кто звонил: Аноним\nНомер линии: 8 (423) 200-00-00",
    }),
    [],
  );
  assert.deepEqual(
    extractCallerPhones({
      name: "Входящий звонок 8 (423) 222-29-99",
      description: "Кто звонил: скрыт\nтел. 8 (914) 555-01-42",
    }),
    [],
  );
  assert.deepEqual(
    extractCallerPhones({
      name: "Входящий звонок 8 (423) 222-29-99",
      description: "Кто звонил:\nС кем говорил: Иванов",
    }),
    [],
  );
  // Обрывок, не дотягивающий до полного номера, — тоже не звонящий
  assert.deepEqual(
    extractCallerPhones({
      name: "Входящий звонок 8 (423) 222-29-99",
      description: "Кто звонил: 123456\nтел. 8 (914) 555-01-42",
    }),
    [],
  );
  // То же для письма, у которого есть только HTML-часть
  assert.deepEqual(
    extractCallerPhones({
      name: "Входящий звонок 8 (423) 222-29-99",
      htmlDescription: "<p>Кто звонил: Аноним</p>\n<p>Номер линии: 8 (423) 200-00-00</p>",
    }),
    [],
  );
});

test("the first «Кто звонил» line decides", () => {
  // Старое уведомление, пересланное ниже, не подменяет скрытого звонящего
  assert.deepEqual(
    extractCallerPhones({ description: "Кто звонил: Аноним\n\n> Кто звонил: +7 914 555-01-42" }),
    [],
  );
  assert.deepEqual(
    extractCallerPhones({ description: "Кто звонил: +7 914 555-01-42\n\n> Кто звонил: +7 (812) 123-45-67" }),
    ["79145550142"],
  );
});

test("landlines are recognised now, not only mobiles", () => {
  assert.deepEqual(extractCallerPhones({ name: "Звонок +7 (812) 123-45-67" }), ["78121234567"]);
  assert.deepEqual(extractCallerPhones({ description: "тел. 8 (423) 222-29-99" }), ["74232222999"]);
});

test("an INN in a signature does not hide the real number", () => {
  assert.deepEqual(
    extractCallerPhones({ description: "ООО «Восток», ИНН 7701234567\nтел. 8 (914) 555-01-42" }),
    ["79145550142"],
  );
});

test("a foreign number counts only when dialled with a plus", () => {
  assert.deepEqual(extractCallerPhones({ description: "WhatsApp +375 29 123-45-67" }), ["375291234567"]);
  assert.deepEqual(extractCallerPhones({ description: "заказ 375291234567" }), []);
});

test("the same number twice is listed once; no numbers — empty list", () => {
  assert.deepEqual(
    extractCallerPhones({ name: "+7 914 555-01-42", description: "Кто звонил: 8 (914) 555-01-42" }),
    ["79145550142"],
  );
  assert.deepEqual(extractCallerPhones({ name: "Не печатает принтер" }), []);
});

test("the same number in the subject and the body is listed once", () => {
  // Без строки «Кто звонил» повторы выпадают при переборе темы и тела
  assert.deepEqual(
    extractCallerPhones({ name: "+7 914 555-01-42", description: "тел. 8 (914) 555-01-42" }),
    ["79145550142"],
  );
});

test("numbers on consecutive lines stay separate", () => {
  assert.deepEqual(
    extractCallerPhones({ description: "тел. 8 (423) 222-29-99\n8 (914) 555-01-42" }),
    ["74232222999", "79145550142"],
  );
  // Дата на следующей строке не приклеивается к номеру и не ломает его
  assert.deepEqual(
    extractCallerPhones({ description: "Кто звонил: +7 914 555-01-42\n30-09-2026 12:00" }),
    ["79145550142"],
  );
});

test("a non-breaking space inside a number does not split it", () => {
  // Почта, собранная из HTML, приносит U+00A0 между группами цифр
  assert.deepEqual(
    extractCallerPhones({ description: "Кто звонил: +7\xa0914\xa0555-01-42" }),
    ["79145550142"],
  );
  assert.deepEqual(extractCallerPhones({ name: "Звонок 8\xa0(423)\xa0222-29-99" }), ["74232222999"]);
});

test("the label behind &nbsp; is still found in an HTML-only mail", () => {
  // Метка не нашлась бы — первым кандидатом стал бы номер нашей линии из темы
  assert.deepEqual(
    extractCallerPhones({
      name: "Входящий звонок 8 (423) 200-00-00",
      htmlDescription:
        "<p>Номер линии: 8 (423) 200-00-00</p><p>Кто&nbsp;звонил: +7 914 555-01-42</p>",
    }),
    ["79145550142"],
  );
});

test("the label behind &#160; is found too, in any case", () => {
  assert.deepEqual(
    extractCallerPhones({
      name: "Входящий звонок 8 (423) 200-00-00",
      htmlDescription:
        "<p>Номер линии: 8 (423) 200-00-00</p><p>Кто&#160;звонил: +7 914 555-01-42</p>",
    }),
    ["79145550142"],
  );
  assert.deepEqual(
    extractCallerPhones({
      name: "Входящий звонок 8 (423) 200-00-00",
      htmlDescription: "<p>Кто&#xA0;звонил: +7 914 555-01-42</p>",
    }),
    ["79145550142"],
  );
});

test("a non-breaking space between the label's words is a space", () => {
  // Текстовую часть HTML-письма mailparser собирает сам, и &nbsp; попадает в
  // неё символом U+00A0
  assert.deepEqual(
    extractCallerPhones({
      name: "Входящий звонок 8 (423) 200-00-00",
      description: "Номер линии: 8 (423) 200-00-00\n\nКто\xa0звонил: +7\xa0914\xa0555-01-42",
    }),
    ["79145550142"],
  );
});

test("our own line is never a candidate", () => {
  // Метки нет: номер линии в теме выпадает, звонящий из тела остаётся
  assert.deepEqual(
    extractCallerPhones(
      {
        name: "Входящий звонок 8 (423) 200-00-00",
        description: "Перезвоните: 8 (914) 555-01-42",
      },
      { ownPhones: ["+7 (423) 200-00-00"] },
    ),
    ["79145550142"],
  );
  // Пустое значение настройки ничего не отсекает
  assert.deepEqual(
    extractCallerPhones(
      { description: "Кто звонил: +7 914 555-01-42" },
      { ownPhones: ["", null, undefined] },
    ),
    ["79145550142"],
  );
});

test("our own line at the label means no caller", () => {
  assert.deepEqual(
    extractCallerPhones(
      {
        name: "Входящий звонок 8 (423) 200-00-00",
        description: "Кто звонил: 8 (423) 200-00-00\nтел. 8 (914) 555-01-42",
      },
      { ownPhones: ["74232000000"] },
    ),
    [],
  );
});

test("a number with &nbsp; between its groups is read whole under the label", () => {
  assert.deepEqual(
    extractCallerPhones({
      htmlDescription: "<td>Кто звонил:</td><td>+7&nbsp;914&nbsp;555-01-42</td>",
    }),
    ["79145550142"],
  );
});

test("a number shared by two people matches nobody", () => {
  assert.equal(onlyOne([]), null);
  assert.deepEqual(onlyOne([{ _id: "a" }]), { _id: "a" });
  assert.equal(onlyOne([{ _id: "a" }, { _id: "b" }]), null);
});

test("findByAnyPhone returns the first match and stops", async () => {
  const asked = [];
  const lookup = async (phone) => {
    asked.push(phone);
    return phone === "2" ? { found: phone } : null;
  };
  assert.deepEqual(await findByAnyPhone(["1", "2", "3"], lookup), { found: "2" });
  // «3» не спрашивали: после первого совпадения перебор кончился
  assert.deepEqual(asked, ["1", "2"]);
  assert.equal(await findByAnyPhone(["1", "3"], async () => null), null);
});

test("lookups ignore values that are not a full number", async () => {
  // Сеттер схемы превращает «+7» и «abc» в пустую строку, а запрос по пустому
  // телефону нашёл бы каждую запись без телефона. Охрана срабатывает раньше
  // любого обращения к модели, поэтому база тут не нужна
  assert.deepEqual(await findUsersByPhone("+7"), []);
  assert.deepEqual(await findUsersByPhone("abc"), []);
  assert.deepEqual(await findUsersByPhone(""), []);
  assert.equal(await findApplicantByPhone("abc"), null);
  assert.equal(await findCompanyByPhone(""), null);
  assert.equal(await findCompanyByPhone("+7"), null);
  assert.equal(await findCompanyByPhone("abc"), null);
});

test("extractEmail reads the whole address, not a prefix of a longer one", () => {
  // Законный вид строки отправителя: с именем, голый, с «+» в локальной части
  assert.equal(extractEmail("Иван <calls@mango.ru>"), "calls@mango.ru");
  assert.equal(extractEmail("calls@mango.ru"), "calls@mango.ru");
  assert.equal(extractEmail("ivan+tag@corp.ru"), "ivan+tag@corp.ru");
  // Домен, которому запись DMARC не нужна вовсе, не должен сойти за настоящий:
  // иначе письмо с «calls@mango.ru.1» прошло бы за аккаунт телефонии
  assert.equal(extractEmail("calls@mango.ru.1"), "");
  assert.equal(extractEmail("boss@client.ru_evil.com"), "");
  assert.equal(extractEmail("boss@client.ru."), "");
});

test("extractCallerPhones: тег в HTML-теле заменяется пробелом, а не пустотой", () => {
  // «Кто<b>звонил</b>» читается как «Кто звонил»: метка найдена, номера при ней
  // нет — звонящий скрыт, и номер линии из темы кандидатом не становится. Замени
  // тег пустотой, метка слиплась бы («Ктозвонил»), и ответом стал бы номер из темы
  assert.deepEqual(
    extractCallerPhones({
      name: "Входящий звонок 8 (423) 222-29-99",
      htmlDescription: "<p>Кто<b>звонил</b>: Аноним</p>",
    }),
    [],
  );
});

const HANG_MS = 3000;

// { timeout } у node:test синхронный код не прерывает, а прежняя регулярка `<[^>]+>`
// на мегабайте «<» думала минуты (квадратично). vm-таймаут V8 прерывает и её:
// регресс роняет тест за HANG_MS, а не вешает прогон.
// Время меряем процессорное (process.cpuUsage), а не стенными часами: под нагрузкой
// процесс вытесняют, и стенные часы давали ложные падения. vm-таймаут остаётся по
// стенным часам — это страховка от зависания, а не измерение.
const timed = (label, run) => {
  let ms = 0;
  const measure = () => {
    const cpuBefore = process.cpuUsage();
    run();
    const cpu = process.cpuUsage(cpuBefore);
    ms = (cpu.user + cpu.system) / 1000;
  };
  try {
    vm.runInNewContext("measure()", { measure }, { timeout: HANG_MS });
  } catch (error) {
    if (error?.code !== "ERR_SCRIPT_EXECUTION_TIMEOUT") throw error;
    assert.fail(`${label}: не уложился в ${HANG_MS} мс — разбор перестал быть линейным`);
  }
  return ms;
};

test("extractCallerPhones: мегабайт «<» в HTML-теле разбирается за линейное время", { timeout: 5000 }, () => {
  const htmlDescription = "<".repeat(1024 * 1024);
  let phones;
  const ms = timed("мегабайт «<»", () => {
    phones = extractCallerPhones({ htmlDescription });
  });
  assert.deepEqual(phones, []);
  assert.ok(ms < 200, `мегабайт «<»: ${ms.toFixed(1)} мс`);
});
