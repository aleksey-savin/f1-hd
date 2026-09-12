// node --test services/ticketUnread.test.js
require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");

const { computeUnread } = require("./ticketUnread");

const ME = "u1";
const OTHER = "u2";
const at = (hour) => new Date(`2026-09-12T${String(hour).padStart(2, "0")}:00:00Z`);
const comment = (by, hour) => ({ createdBy: by, createdAt: at(hour) });

test("без движения заявка прочитана", () => {
  assert.deepEqual(computeUnread({ ticket: {}, seenAt: null, userId: ME }), {
    isUnseen: false,
    newComments: 0,
  });
});

test("своё движение не делает заявку непрочитанной", () => {
  const ticket = { activity: { at: at(10), by: ME } };
  assert.deepEqual(computeUnread({ ticket, seenAt: null, userId: ME }), {
    isUnseen: false,
    newComments: 0,
  });
});

test("чужое движение по ни разу не открытой заявке — непрочитано, без счётчика", () => {
  const ticket = {
    activity: { at: at(10), by: OTHER },
    comments: [comment(OTHER, 9), comment(OTHER, 10)],
  };
  assert.deepEqual(computeUnread({ ticket, seenAt: null, userId: ME }), {
    isUnseen: true,
    newComments: 0,
  });
});

test("чужое движение после визита — непрочитано, новые чужие комментарии считаются", () => {
  const ticket = {
    activity: { at: at(11), by: OTHER },
    comments: [
      comment(OTHER, 7), // до визита
      comment(ME, 9), // свой
      comment(OTHER, 10),
      comment({ _id: OTHER }, 11), // populated автор
    ],
  };
  assert.deepEqual(computeUnread({ ticket, seenAt: at(8), userId: ME }), {
    isUnseen: true,
    newComments: 2,
  });
});

test("движение до визита — прочитано", () => {
  const ticket = {
    activity: { at: at(10), by: OTHER },
    comments: [comment(OTHER, 10)],
  };
  assert.deepEqual(computeUnread({ ticket, seenAt: at(12), userId: ME }), {
    isUnseen: false,
    newComments: 0,
  });
});

test("даты строками (после .lean()/JSON) сравниваются как даты", () => {
  const ticket = {
    activity: { at: at(11).toISOString(), by: OTHER },
    comments: [{ createdBy: OTHER, createdAt: at(11).toISOString() }],
  };
  assert.deepEqual(
    computeUnread({ ticket, seenAt: at(8).toISOString(), userId: ME }),
    { isUnseen: true, newComments: 1 },
  );
});
