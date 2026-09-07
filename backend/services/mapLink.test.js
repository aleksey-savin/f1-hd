// node --test services/mapLink.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  parseMapLinkCoords,
  isShortMapLink,
  resolveMapLink,
} = require("./mapLink");

test("parse: pt= marker gives the point (lon,lat order)", () => {
  assert.deepEqual(
    parseMapLinkCoords("https://yandex.ru/maps/?pt=37.6083,55.7601&z=17"),
    { lat: 55.7601, lon: 37.6083 },
  );
});

test("parse: whatshere[point] wins over the map centre", () => {
  assert.deepEqual(
    parseMapLinkCoords(
      "https://yandex.ru/maps/213/moscow/?ll=37.6177%2C55.7558&mode=whatshere&whatshere%5Bpoint%5D=37.6083%2C55.7601&z=17",
    ),
    { lat: 55.7601, lon: 37.6083 },
  );
});

test("parse: ll= centre is the fallback", () => {
  assert.deepEqual(
    parseMapLinkCoords(
      "https://yandex.ru/maps/75/vladivostok/house/shilkinskaya_ulitsa_32a/ZUoHaA5jSEQGXEJuYGJwcHtqYgw=/?ll=131.931110%2C43.117964&z=17.19&utm_source=share",
    ),
    { lat: 43.117964, lon: 131.93111 },
  );
});

test("parse: no coordinates, garbage or empty → null", () => {
  assert.equal(parseMapLinkCoords("https://yandex.ru/maps/-/CTdJv0Z5"), null);
  assert.equal(parseMapLinkCoords("https://go.2gis.com/IOex4"), null);
  assert.equal(parseMapLinkCoords("not a url"), null);
  assert.equal(parseMapLinkCoords(""), null);
  assert.equal(parseMapLinkCoords(null), null);
  assert.equal(parseMapLinkCoords("https://yandex.ru/maps/?ll=abc,def"), null);
});

test("parse: 2GIS address-bar link — the object point in the path wins over the map centre", () => {
  assert.deepEqual(
    parseMapLinkCoords(
      "https://2gis.ru/vladivostok/geo/3519072864050171/131.931110,43.117964?m=131.90%2C43.10%2F16",
    ),
    { lat: 43.117964, lon: 131.93111 },
  );
  assert.deepEqual(
    parseMapLinkCoords(
      "https://2gis.ru/vladivostok/firm/70000001030877797/131.885,43.115",
    ),
    { lat: 43.115, lon: 131.885 },
  );
});

test("parse: 2GIS map centre m=lon,lat/zoom is the fallback", () => {
  assert.deepEqual(
    parseMapLinkCoords("https://2gis.ru/vladivostok?m=131.885%2C43.115%2F16"),
    { lat: 43.115, lon: 131.885 },
  );
});

test("parse: a lon,lat-looking segment on a foreign host is ignored", () => {
  assert.equal(
    parseMapLinkCoords("https://example.com/path/131.885,43.115"),
    null,
  );
});

test("short link: 2GIS share links go.2gis.com/<code> count too", () => {
  assert.equal(isShortMapLink("https://go.2gis.com/IOex4"), true);
  assert.equal(isShortMapLink("https://go.2gis.com/"), false);
  assert.equal(isShortMapLink("https://2gis.ru/vladivostok/firm/1"), false);
  assert.equal(isShortMapLink("https://go.2gis.com.evil.net/IOex4"), false);
});

test("short link: Yandex Maps share links count", () => {
  assert.equal(isShortMapLink("https://yandex.ru/maps/-/CTdJv0Z5"), true);
  assert.equal(isShortMapLink("https://yandex.com/maps/-/CTdJv0Z5"), true);
  assert.equal(isShortMapLink("https://maps.yandex.ru/-/CTdJv0Z5"), true);
  assert.equal(isShortMapLink("https://YANDEX.RU/maps/-/CTdJv0Z5"), true);
  assert.equal(isShortMapLink("https://yandex.ru/maps/?pt=1,2"), false);
  assert.equal(isShortMapLink("https://evil.example/maps/-/x"), false);
  assert.equal(isShortMapLink(""), false);
});

test("short link: look-alike hosts are not Yandex", () => {
  assert.equal(isShortMapLink("https://yandex.evil.com/maps/-/x"), false);
  assert.equal(isShortMapLink("https://yandex.ru.evil.com/maps/-/x"), false);
  assert.equal(isShortMapLink("https://notyandex.ru/maps/-/x"), false);
  assert.equal(isShortMapLink("http://yandex.ru:8080/maps/-/x"), false);
  assert.equal(isShortMapLink("https://yandex.internal/maps/-/x"), false);
});

test("resolve: a redirect to a foreign host is not followed", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return {
      status: 302,
      headers: new Map([["location", "https://yandex.evil.com/maps/-/next"]]),
    };
  };
  const result = await resolveMapLink("https://yandex.ru/maps/-/DDDD", {
    fetchImpl,
  });
  assert.equal(result, null);
  assert.deepEqual(calls, ["https://yandex.ru/maps/-/DDDD"]);
});

const redirectingFetch = (location) => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { status: 301, headers: new Map([["location", location]]) };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
};

test("resolve: a long link with coordinates needs no network", async () => {
  const fetchImpl = redirectingFetch("/never");
  const result = await resolveMapLink("https://yandex.ru/maps/?pt=37.6,55.7", {
    fetchImpl,
  });
  assert.deepEqual(result, { lat: 55.7, lon: 37.6 });
  assert.equal(fetchImpl.calls.length, 0);
});

test("resolve: a short link follows the redirect and reads the final URL", async () => {
  const fetchImpl = redirectingFetch(
    "/maps/75/vladivostok/house/shilkinskaya_ulitsa_32a/ZUoHaA5jSEQGXEJuYGJwcHtqYgw=/?ll=131.931110%2C43.117964&z=17.19&utm_source=share",
  );
  const result = await resolveMapLink("https://yandex.ru/maps/-/CTdJv0Z5", {
    fetchImpl,
  });
  assert.deepEqual(result, { lat: 43.117964, lon: 131.93111 });
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fetchImpl.calls[0].url, "https://yandex.ru/maps/-/CTdJv0Z5");
  assert.equal(fetchImpl.calls[0].options.redirect, "manual");
});

test("resolve: a foreign host is never fetched", async () => {
  const fetchImpl = redirectingFetch("https://yandex.ru/maps/?pt=1,2");
  const result = await resolveMapLink("https://goo.gl/maps/abc123", {
    fetchImpl,
  });
  assert.equal(result, null);
  assert.equal(fetchImpl.calls.length, 0);
});

test("resolve: redirect without coordinates or a network error → null", async () => {
  const noCoords = redirectingFetch("/maps/213/moscow/");
  assert.equal(
    await resolveMapLink("https://yandex.ru/maps/-/AAAA", { fetchImpl: noCoords }),
    null,
  );
  const failing = async () => {
    throw new Error("ECONNRESET");
  };
  assert.equal(
    await resolveMapLink("https://yandex.ru/maps/-/BBBB", { fetchImpl: failing }),
    null,
  );
});

test("resolve: a 2GIS short link is fetched like a browser and read from the redirect", async () => {
  const fetchImpl = redirectingFetch(
    "https://2gis.ru/vladivostok/firm/70000001030877797/131.885,43.115?m=131.885%2C43.115%2F16",
  );
  const result = await resolveMapLink("https://go.2gis.com/IOex4", {
    fetchImpl,
  });
  assert.deepEqual(result, { lat: 43.115, lon: 131.885 });
  assert.equal(fetchImpl.calls.length, 1);
  const { options } = fetchImpl.calls[0];
  assert.equal(options.redirect, "manual");
  assert.equal(options.method, "GET");
  assert.match(options.headers["user-agent"], /Mozilla/);
  assert.match(options.headers["accept-language"], /^ru/);
});

test("resolve: the 2GIS bot wall (museum) yields no point and no further fetch", async () => {
  const fetchImpl = redirectingFetch(
    "https://2gis.ru/museum?return_url=https%3A%2F%2F2gis.ru%2Fvladivostok%2Ffirm%2F1",
  );
  const result = await resolveMapLink("https://go.2gis.com/6orni", {
    fetchImpl,
  });
  assert.equal(result, null);
  assert.equal(fetchImpl.calls.length, 1);
});

test("resolve: redirect chains stop after a few hops", async () => {
  let hops = 0;
  const looping = async () => {
    hops += 1;
    return { status: 302, headers: new Map([["location", "/maps/-/again"]]) };
  };
  assert.equal(
    await resolveMapLink("https://yandex.ru/maps/-/CCCC", { fetchImpl: looping }),
    null,
  );
  assert.ok(hops <= 5, `followed ${hops} hops`);
});
