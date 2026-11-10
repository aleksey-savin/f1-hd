// Debian Policy 5.6.12: epochs, upstream versions and Debian revisions.
// https://www.debian.org/doc/debian-policy/ch-controlfields.html#version
const part = (a, b) => {
  let i = 0,
    j = 0;
  const digit = (c) => c >= "0" && c <= "9";
  const order = (c) =>
    c === "~"
      ? -1
      : !c || digit(c)
        ? 0
        : /[A-Za-z]/.test(c)
          ? c.charCodeAt(0)
          : c.charCodeAt(0) + 256;
  while (i < a.length || j < b.length) {
    while ((a[i] && !digit(a[i])) || (b[j] && !digit(b[j]))) {
      const difference = order(a[i]) - order(b[j]);
      if (difference) return Math.sign(difference);
      if (a[i]) i++;
      if (b[j]) j++;
    }
    while (a[i] === "0") i++;
    while (b[j] === "0") j++;
    let endA = i,
      endB = j;
    while (digit(a[endA])) endA++;
    while (digit(b[endB])) endB++;
    if (endA - i !== endB - j) return Math.sign(endA - i - (endB - j));
    const x = a.slice(i, endA),
      y = b.slice(j, endB);
    if (x !== y) return x < y ? -1 : 1;
    i = endA;
    j = endB;
  }
  return 0;
};
const split = (version) => {
  if (
    typeof version !== "string" ||
    !/^(?:\d+:)?\d[A-Za-z0-9.+:~-]*$/.test(version) ||
    version.length > 300
  )
    throw new Error("Некорректная версия Debian-пакета");
  const colon = version.indexOf(":");
  const epoch = colon < 0 ? 0n : BigInt(version.slice(0, colon));
  const rest = colon < 0 ? version : version.slice(colon + 1);
  const dash = rest.lastIndexOf("-");
  return {
    epoch,
    upstream: dash < 0 ? rest : rest.slice(0, dash),
    revision: dash < 0 ? "0" : rest.slice(dash + 1),
  };
};
const compareDebianVersions = (a, b) => {
  const x = split(a),
    y = split(b);
  return x.epoch !== y.epoch
    ? x.epoch < y.epoch
      ? -1
      : 1
    : part(x.upstream, y.upstream) || part(x.revision, y.revision);
};
const affectedByRanges = (version, ranges) => {
  for (const range of ranges) {
    if (range.type !== "ECOSYSTEM") continue;
    let included = false;
    for (const event of range.events) {
      if (event.introduced !== undefined)
        included =
          event.introduced === "0" ||
          compareDebianVersions(version, event.introduced) >= 0;
      if (
        event.fixed !== undefined ||
        event.limit !== undefined ||
        event.last_affected !== undefined
      ) {
        const end = event.fixed ?? event.limit ?? event.last_affected;
        if (
          included &&
          (event.last_affected !== undefined
            ? compareDebianVersions(version, end) <= 0
            : compareDebianVersions(version, end) < 0)
        )
          return true;
        included = false;
      }
    }
    if (included) return true;
  }
  return false;
};
module.exports = { compareDebianVersions, affectedByRanges };
