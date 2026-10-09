// RouterOS API reply reader — replaces routeros-node's own after login.
//
// The library parses every socket chunk on its own and assumes one-byte word
// lengths. A reply therefore loses its `!done` — and the command's promise
// never settles — as soon as (a) any word is 128 bytes or longer (a long
// comment, a v6 group policy) or (b) the reply arrives split across two chunks.
// On prod (09.10) that turned a healthy /user/print into "read timeout", which
// the save path reads as "the account lacks `policy`". It also cut every value
// at its first "=".
//
// The wire format: a sentence is a run of length-prefixed words closed by a
// zero-length word; the length prefix is 1–5 bytes (high bits of the first
// byte say how many). A reply is `!re` sentences (rows), optional `!trap`
// sentences (errors) and a closing `!done` (which may carry `=ret=`).

// [prefixBytes, wordLength], or null when the prefix itself is not complete yet.
const readLength = (buffer, offset) => {
  const first = buffer[offset];
  let size = 1;
  if ((first & 0x80) === 0) return [1, first];
  if ((first & 0xc0) === 0x80) size = 2;
  else if ((first & 0xe0) === 0xc0) size = 3;
  else if ((first & 0xf0) === 0xe0) size = 4;
  else size = 5;
  if (offset + size > buffer.length) return null;
  let length = size === 5 ? 0 : first & (0xff >> size);
  for (let i = 1; i < size; i += 1) length = length * 256 + buffer[offset + i];
  return [size, length];
};

// Stateful: feed(chunk) returns the sentences (arrays of words) completed by
// this chunk; an unfinished word or sentence waits for the next one.
const createSentenceReader = () => {
  let pending = Buffer.alloc(0);
  let words = [];
  return {
    feed(chunk) {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      const sentences = [];
      let offset = 0;
      while (offset < pending.length) {
        const header = readLength(pending, offset);
        if (!header) break;
        const [prefix, length] = header;
        if (offset + prefix + length > pending.length) break;
        offset += prefix;
        if (length === 0) {
          sentences.push(words);
          words = [];
        } else {
          words.push(pending.toString("utf8", offset, offset + length));
          offset += length;
        }
      }
      pending = pending.subarray(offset);
      return sentences;
    },
  };
};

// "=key=value" → [key, value]; the value keeps its own "=" signs.
const splitAttribute = (word) => {
  const end = word.indexOf("=", 1);
  return end === -1 ? [word.slice(1), ""] : [word.slice(1, end), word.slice(end + 1)];
};

// Folds reply sentences into the command's outcome. push(sentence) returns
// null until `!done`, then { rows } or { error } — the same shapes the library
// produced: rows as plain objects, a lone `=ret=` as [{ ret }], a trap as one
// message of all its attribute values joined with ". ".
const createReplyCollector = () => {
  const rows = [];
  const trapValues = [];
  let trapped = false;
  return {
    push(sentence) {
      const [type, ...attributes] = sentence;
      const pairs = attributes
        .filter((word) => word.startsWith("="))
        .map(splitAttribute);
      if (type === "!re") {
        rows.push(Object.fromEntries(pairs));
        return null;
      }
      if (type === "!trap" || type === "!fatal") {
        trapped = true;
        trapValues.push(...pairs.map(([, value]) => value));
        if (type === "!fatal") {
          trapValues.push(...attributes.filter((word) => !word.startsWith("=")));
          return { error: new Error(trapValues.join(". ")) };
        }
        return null;
      }
      if (type === "!done") {
        if (trapped) return { error: new Error(trapValues.join(". ")) };
        const ret = pairs.find(([key]) => key === "ret");
        return { rows: ret && rows.length === 0 ? [{ ret: ret[1] }] : rows };
      }
      // `!empty` (RouterOS 7.18+: a print with no rows) and anything unknown.
      return null;
    },
  };
};

// Sends one command on a logged-in routeros-node connection and resolves its
// rows. Commands run one at a time (every caller awaits), so a single listener
// per command is enough; it is removed once the reply is complete. A reply that
// never completes is bounded by the callers (withReadTimeout / poll deadline).
const sendCommand = (routeros, words) =>
  new Promise((resolve, reject) => {
    const reader = createSentenceReader();
    const collector = createReplyCollector();
    const onData = (chunk) => {
      for (const sentence of reader.feed(chunk)) {
        const outcome = collector.push(sentence);
        if (!outcome) continue;
        routeros.socket.off("data", onData);
        if (outcome.error) reject(outcome.error);
        else resolve(outcome.rows);
        return;
      }
    };
    routeros.socket.on("data", onData);
    routeros.writeWords(words);
  });

module.exports = {
  createSentenceReader,
  createReplyCollector,
  sendCommand,
};
