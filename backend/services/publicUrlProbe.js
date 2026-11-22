const dns = require("node:dns").promises;
const http = require("node:http");
const https = require("node:https");
const { isIP, BlockList } = require("node:net");

// Only globally routed addresses may be used for model-supplied documentation.
const excluded = new BlockList();
for (const [ip, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
])
  excluded.addSubnet(ip, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
for (const [ip, prefix] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
])
  excluded.addSubnet(ip, prefix, "ipv6");
const isPublicAddress = (address) => {
  const family = isIP(address);
  return family === 4
    ? !excluded.check(address, "ipv4")
    : family === 6 &&
        globalV6.check(address, "ipv6") &&
        !excluded.check(address, "ipv6");
};

const abortable = (promise, signal) =>
  new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
  });

const requestHeaders = (url, { method, signal, addresses }) =>
  new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? https : http).request(
      url,
      {
        method,
        signal,
        agent: false,
        // Pin the validated DNS answers for this connection. No second DNS lookup,
        // no reusable sockets and no proxy inherited from the process environment.
        lookup: (_host, options, callback) =>
          options.all
            ? callback(null, addresses)
            : callback(null, addresses[0].address, addresses[0].family),
      },
      (response) => {
        resolve({
          status: response.statusCode,
          location: response.headers.location,
        });
        response.destroy(); // GET fallback needs headers only; never buffer remote bodies.
      },
    );
    request.on("error", reject);
    request.end();
  });

const probePublicUrl = async (
  raw,
  {
    signal = AbortSignal.timeout(6000),
    lookup = dns.lookup,
    request = requestHeaders,
  } = {},
) => {
  let url = new URL(raw);
  let method = "HEAD";
  for (let hop = 0; hop <= 5; hop++) {
    signal.throwIfAborted();
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error("Unsafe documentation URL");
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const family = isIP(host);
    const addresses = family
      ? [{ address: host, family }]
      : await abortable(lookup(host, { all: true, verbatim: true }), signal);
    if (
      !addresses.length ||
      addresses.some(({ address }) => !isPublicAddress(address))
    )
      throw new Error("Documentation URL is not public");
    let result = await request(url, { method, signal, addresses });
    if (method === "HEAD" && [403, 405, 501].includes(result.status)) {
      method = "GET";
      result = await request(url, { method, signal, addresses });
    }
    if ([301, 302, 303, 307, 308].includes(result.status)) {
      if (!result.location) throw new Error("Redirect without a destination");
      url = new URL(result.location, url);
      continue;
    }
    return result.status;
  }
  throw new Error("Too many documentation redirects");
};
module.exports = { probePublicUrl, isPublicAddress };
