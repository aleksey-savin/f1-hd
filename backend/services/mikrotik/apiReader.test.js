// node --test services/mikrotik/apiReader.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const {
  createSentenceReader,
  createReplyCollector,
  sendCommand,
} = require("./apiReader");

const word = (text) => {
  const body = Buffer.from(text);
  const length = body.length;
  let prefix;
  if (length < 0x80) prefix = Buffer.from([length]);
  else if (length < 0x4000) prefix = Buffer.from([(length >> 8) | 0x80, length & 0xff]);
  else prefix = Buffer.from([(length >> 16) | 0xc0, (length >> 8) & 0xff, length & 0xff]);
  return Buffer.concat([prefix, body]);
};
const sentence = (...words) => Buffer.concat([...words.map(word), Buffer.from([0])]);

const USERS = Buffer.concat([
  sentence("!re", "=name=admin", "=group=full", `=comment=${"x".repeat(130)}`),
  sentence("!re", "=name=f1-hd", "=group=hd-mgmt"),
  sentence("!done"),
]);

const collect = (chunks) => {
  const reader = createSentenceReader();
  return chunks.flatMap((chunk) => reader.feed(chunk));
};

test("a word of 128+ bytes does not derail the reply", () => {
  const sentences = collect([USERS]);
  assert.equal(sentences.length, 3);
  assert.equal(sentences[0][3].length, "=comment=".length + 130);
  assert.deepEqual(sentences[1], ["!re", "=name=f1-hd", "=group=hd-mgmt"]);
  assert.deepEqual(sentences[2], ["!done"]);
});

test("a reply split at any byte parses the same", () => {
  const whole = collect([USERS]);
  for (let cut = 1; cut < USERS.length; cut += 1) {
    assert.deepEqual(
      collect([USERS.subarray(0, cut), USERS.subarray(cut)]),
      whole,
      `cut at ${cut}`,
    );
  }
});

test("three-byte lengths and multi-byte text", () => {
  const big = "я".repeat(9000); // 18000 bytes
  const sentences = collect([sentence("!re", `=comment=${big}`), sentence("!done")]);
  assert.equal(sentences[0][1], `=comment=${big}`);
});

const outcomeOf = (buffer) => {
  const collector = createReplyCollector();
  let outcome = null;
  for (const item of collect([buffer])) outcome = outcome || collector.push(item);
  return outcome;
};

test("rows keep '=' inside values", () => {
  const outcome = outcomeOf(
    Buffer.concat([sentence("!re", "=name=wg", "=comment=a=b=c"), sentence("!done")]),
  );
  assert.deepEqual(outcome.rows, [{ name: "wg", comment: "a=b=c" }]);
});

test("no rows, !empty, and =ret=", () => {
  assert.deepEqual(outcomeOf(sentence("!done")).rows, []);
  assert.deepEqual(outcomeOf(Buffer.concat([sentence("!empty"), sentence("!done")])).rows, []);
  assert.deepEqual(outcomeOf(sentence("!done", "=ret=abc=")).rows, [{ ret: "abc=" }]);
});

test("a trap rejects with the library's message shape", () => {
  const outcome = outcomeOf(
    Buffer.concat([
      sentence("!trap", "=category=0", "=message=no such command or directory (routerboard)"),
      sentence("!trap", "=message=no such command prefix"),
      sentence("!done"),
    ]),
  );
  assert.equal(
    outcome.error.message,
    "0. no such command or directory (routerboard). no such command prefix",
  );
});

test("sendCommand resolves across chunks and releases its listener", async () => {
  const socket = new EventEmitter();
  const sent = [];
  const routeros = { socket, writeWords: (words) => sent.push(words) };
  const promise = sendCommand(routeros, ["/user/print"]);
  socket.emit("data", USERS.subarray(0, 100));
  socket.emit("data", USERS.subarray(100));
  const rows = await promise;
  assert.equal(rows.length, 2);
  assert.equal(rows[1].group, "hd-mgmt");
  assert.deepEqual(sent, [["/user/print"]]);
  assert.equal(socket.listenerCount("data"), 0);
});
