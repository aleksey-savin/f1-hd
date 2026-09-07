// node --test src/util/taxi-operators.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import { openTaxi } from "./taxi-operators.js";

// Контракт браузера: window.open с noopener (или noreferrer — он включает
// noopener) в features возвращает null — хэндла новой вкладки нет.
const fakeBrowser = () => {
  const tabs = [];
  const window = {
    location: { href: "https://helpdesk.local/companies" },
    open(url, target, features = "") {
      const tab = { location: url, opener: window };
      tabs.push(tab);
      return /\bno(opener|referrer)\b/.test(features) ? null : tab;
    },
  };
  return { window, tabs };
};

// В Node `navigator` — встроенный геттер, простое присваивание бросает
const setGlobal = (name, value) =>
  Object.defineProperty(globalThis, name, {
    value,
    configurable: true,
    writable: true,
  });
const useBrowser = (browser, navigator = {}) => {
  setGlobal("window", browser.window);
  setGlobal("navigator", navigator);
};

test("openTaxi: the order opens in the new tab, the current page stays", () => {
  const browser = fakeBrowser();
  useBrowser(browser);
  openTaxi({ href: "https://taxi.example/order", supportsRoute: false });
  assert.equal(browser.tabs.length, 1);
  assert.equal(browser.tabs[0].location, "https://taxi.example/order");
  assert.equal(
    browser.window.location.href,
    "https://helpdesk.local/companies",
  );
});

test("openTaxi: the new tab has no way back to the app (opener severed)", () => {
  const browser = fakeBrowser();
  useBrowser(browser);
  openTaxi({ href: "https://taxi.example/order", supportsRoute: false });
  assert.equal(browser.tabs[0].opener, null);
});

test("openTaxi: with geolocation the route starts from the current position", () => {
  const browser = fakeBrowser();
  useBrowser(browser, {
    geolocation: {
      getCurrentPosition: (onSuccess) =>
        onSuccess({ coords: { latitude: 55.7, longitude: 37.6 } }),
    },
  });
  openTaxi({
    href: "https://taxi.example/order",
    supportsRoute: true,
    buildHref: (origin) =>
      `https://taxi.example/route?from=${origin.lat},${origin.lon}`,
  });
  assert.equal(
    browser.tabs[0].location,
    "https://taxi.example/route?from=55.7,37.6",
  );
  assert.equal(
    browser.window.location.href,
    "https://helpdesk.local/companies",
  );
});

test("openTaxi: geolocation refused → the same tab gets the plain order link", () => {
  const browser = fakeBrowser();
  useBrowser(browser, {
    geolocation: {
      getCurrentPosition: (onSuccess, onError) => onError(new Error("denied")),
    },
  });
  openTaxi({
    href: "https://taxi.example/order",
    supportsRoute: true,
    buildHref: () => "https://taxi.example/route",
  });
  assert.equal(browser.tabs.length, 1);
  assert.equal(browser.tabs[0].location, "https://taxi.example/order");
});
