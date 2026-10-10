const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const { openShell, shellLogin } = require("./sshShell");

// Поддельный поток интерактивной оболочки
const fakeConn = () => {
  const stream = new EventEmitter();
  stream.written = [];
  stream.destroyed = false;
  stream.write = (text) => stream.written.push(text);
  stream.destroy = () => {
    stream.destroyed = true;
  };
  const conn = {
    shellOpts: null,
    shell(opts, cb) {
      conn.shellOpts = opts;
      cb(null, stream);
    },
  };
  return { conn, stream };
};

test("shellLogin добавляет суффикс консоли", () => {
  assert.equal(shellLogin("admin"), "admin+ct200w");
});

test("read ждёт совпадения через два чанка и возвращает текст до конца совпадения", async () => {
  const { conn, stream } = fakeConn();
  const shell = await openShell(conn, {});
  assert.equal(conn.shellOpts.term, "dumb");
  const pending = shell.read({ until: /\] > $/, timeoutMs: 500 });
  stream.emit("data", Buffer.from("banner\r\n[admin@R"));
  stream.emit("data", Buffer.from("] > "));
  assert.equal(await pending, "banner\r\n[admin@R] > ");
  const next = shell.read({ until: /done/, timeoutMs: 500 });
  stream.emit("data", Buffer.from("xx done"));
  assert.equal(await next, "xx done");
});

test("второй read видит только то, что пришло после первого совпадения", async () => {
  const { conn, stream } = fakeConn();
  const shell = await openShell(conn, {});
  stream.emit("data", Buffer.from("one|two"));
  assert.equal(await shell.read({ until: /one\|/, timeoutMs: 500 }), "one|");
  assert.equal(await shell.read({ until: /two/, timeoutMs: 500 }), "two");
});

test("таймаут отклоняет read", async () => {
  const { conn } = fakeConn();
  const shell = await openShell(conn, {});
  await assert.rejects(shell.read({ until: /never/, timeoutMs: 30 }), /shell read timeout/);
});

test("close рвёт поток без quit", async () => {
  const { conn, stream } = fakeConn();
  const shell = await openShell(conn, {});
  shell.write("abc");
  shell.close();
  assert.equal(stream.destroyed, true);
  assert.deepEqual(stream.written, ["abc"]);
});

test("openShell отклоняется по таймауту, если conn.shell не отвечает", async () => {
  const stream = new EventEmitter();
  stream.destroyed = false;
  stream.destroy = () => {
    stream.destroyed = true;
  };
  let late = null;
  const conn = {
    shell(opts, cb) {
      late = cb;
    },
  };
  await assert.rejects(openShell(conn, { openTimeoutMs: 30 }), /shell open timeout/);
  // Опоздавший поток не остаётся висеть
  late(null, stream);
  assert.equal(stream.destroyed, true);
});

test("isOpen и onClose: поток закрылся сам", async () => {
  const { conn, stream } = fakeConn();
  const shell = await openShell(conn, {});
  assert.equal(shell.isOpen(), true);
  let calls = 0;
  shell.onClose(() => {
    calls += 1;
  });
  stream.emit("close");
  stream.emit("end");
  assert.equal(shell.isOpen(), false);
  assert.equal(calls, 1);
});

test("onClose срабатывает на error и end", async () => {
  for (const event of ["error", "end"]) {
    const { conn, stream } = fakeConn();
    const shell = await openShell(conn, {});
    let calls = 0;
    shell.onClose(() => {
      calls += 1;
    });
    stream.emit(event, new Error("boom"));
    assert.equal(calls, 1, event);
    assert.equal(shell.isOpen(), false);
  }
});

test("onClose после закрытия вызывается сразу; close() делает isOpen false", async () => {
  const { conn } = fakeConn();
  const shell = await openShell(conn, {});
  shell.close();
  assert.equal(shell.isOpen(), false);
  let calls = 0;
  shell.onClose(() => {
    calls += 1;
  });
  assert.equal(calls, 1);
});
