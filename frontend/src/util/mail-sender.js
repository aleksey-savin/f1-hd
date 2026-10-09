// Отправитель письма, из которого создана заявка (`ticket.realSender`). Новые
// заявки хранят строку, собранную бэкендом из разобранного адреса
// (services/mail/inbound, senderLine): «Иван Петров <ivan@corp.ru>» или голый
// «ivan@corp.ru»; старые — заголовок From как есть. Заявителя бэкенд опознаёт
// по самому адресу, а не по этой строке.

const ADDRESS_RE = /[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+/;

/**
 * @param {string|undefined|null} raw заголовок From
 * @returns {{ name: string|null, address: string }|null} null — адреса нет
 */
export const parseMailSender = (raw) => {
  const text = String(raw ?? "").trim();
  const match = text.match(ADDRESS_RE);
  if (!match) return null;

  const address = match[0].toLowerCase();
  // Имя — всё до «<» без кавычек; имя, повторяющее адрес, — не имя
  const name = text
    .slice(0, text.indexOf("<") >= 0 ? text.indexOf("<") : 0)
    .replace(/^["'\s]+|["'\s]+$/g, "");

  return {
    name: name && name.toLowerCase() !== address ? name : null,
    address,
  };
};

/** «Иван Петров <ivan@corp.ru>» или «ivan@corp.ru»; null — показывать нечего. */
export const formatMailSender = (raw) => {
  const sender = parseMailSender(raw);
  if (!sender) return null;
  return sender.name ? `${sender.name} <${sender.address}>` : sender.address;
};
