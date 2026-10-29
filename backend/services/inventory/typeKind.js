// Назначение типа устройства хранится тремя флагами, но оно одно: тип —
// устройство (без флагов), комплектующее, расходник или периферия. Проверка
// общая для формы (контроллер) и правок каталога через MCP.

const KIND_FLAGS = ["isComponent", "isConsumable", "isPeripheral"];

const SEVERAL_KINDS_MESSAGE =
  "У типа одно назначение: комплектующее, расходник или периферия — не несколько сразу";

// flags — объект с любыми из KIND_FLAGS (документ, тело запроса, слияние)
const hasSeveralKinds = (flags) =>
  KIND_FLAGS.filter((flag) => flags?.[flag] === true).length > 1;

module.exports = { KIND_FLAGS, SEVERAL_KINDS_MESSAGE, hasSeveralKinds };
