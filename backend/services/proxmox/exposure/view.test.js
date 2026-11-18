const test = require("node:test");
const assert = require("node:assert/strict");
const { publicSummary, publicDetail } = require("./view");
const { nodeLinksVersion } = require("./scope");
const nodeVersion = nodeLinksVersion([{connectionId:"c",nodeName:"pve"}], {connectionId:"c",nodeName:"pve"});
const prefs = {
  modules: { proxmox: { isActive: true }, mikrotik: { isActive: true } },
  proxmox: { networkLinksVersion: nodeVersion, networkLinks:[{connectionId:"c",nodeName:"pve"}] },
};
const resource = {
  _id: "g", connectionId:"c",nodeName:"pve",
  exposureGeneration: 1,
  exposure: {
    generation: 1,
    networkLinksVersion: nodeVersion,
    securityCheckedAt: new Date(0),
    confirmedCveCount: 2,
    coverage: [
      {
        state: "public",
        hasPublic: true,
        publishedCount: 1,
        checkedAt: new Date(0),
        freshUntil: new Date(900000),
        lastAttemptOk: true,
      },
    ],
  },
};
test("public summary dynamically expires while detailed network data requires MikroTik rights", () => {
  assert.equal(publicSummary(resource, prefs, new Date(1)).hasPublic, true);
  assert.equal(
    publicSummary(resource, prefs, new Date(900000)).hasPublic,
    false,
  );
  const report = {
    generation: 1,
    report: {
      publications: [{ internalAddress: "private", routerId: "secret" }],
      sources: [{ routerId: "secret" }],
    },
  };
  const dto = publicDetail(
    resource,
    report,
    { canReadMikrotik: false },
    prefs,
    new Date(1),
  );
  assert.doesNotMatch(JSON.stringify(dto), /private|secret|coverage|routerId/);
  assert.equal(dto.resourceId, "g");
  assert.equal(publicSummary(resource, { modules: {} }, new Date()), null);
});
test("expired first source does not hide another fresh source or claim full coverage", () => {
  const second = {
    ...resource,
    exposure: {
      ...resource.exposure,
      coverage: [
        ...resource.exposure.coverage,
        {
          state: "restricted",
          hasRestricted: true,
          publishedCount: 1,
          freshUntil: new Date(1800000),
          lastAttemptOk: true,
        },
      ],
    },
  };
  const result = publicSummary(second, prefs, new Date(900000));
  assert.equal(result.hasRestricted, true);
  assert.equal(result.hasPublic, false);
  assert.equal(result.publishedCount, 1);
  assert.ok(result.unknownCount);
});
test("publication TTL includes guest evidence, not just a newer router timestamp", () => {
  const item = {
    ...resource,
    exposure: {
      ...resource.exposure,
      coverage: [
        { ...resource.exposure.coverage[0], checkedAt: new Date(840000) },
      ],
    },
  };
  const report = {
    generation: 1,
    report: {
      publications: [
        {
          routerId: "r",
          linkId: "l",
          checkedAt: new Date(840000),
          freshUntil: new Date(900000),
        },
      ],
    },
  };
  const dto = publicDetail(
    item,
    report,
    { canReadMikrotik: true },
    prefs,
    new Date(960000),
  );
  assert.equal(dto.summary.publishedCount, 0);
  assert.equal(dto.publications[0].stale, true);
});
test('unconfigured nodes and links with no actual report do not show network errors',()=>{
 const guest={...resource,connectionId:'c',nodeName:'pve'};
 const unconfigured={...prefs,proxmox:{networkLinks:[]}};
 assert.equal(publicSummary(guest,unconfigured,new Date(1)),null);
 const configured={...prefs,proxmox:{...prefs.proxmox,networkLinks:[{connectionId:'c',nodeName:'pve'}]}};
 assert.equal(publicSummary({...guest,exposure:undefined},configured,new Date(1)),null);
 assert.equal(publicSummary({...guest,nodeName:'other'},configured,new Date(1)),null);
 assert.equal(publicSummary({...guest,exposure:{invalidated:true}},configured,new Date(1)),null);
 assert.ok(publicSummary(guest,configured,new Date(1)));
});
test('changing this node mapping hides previous warnings and details until a new attempt', () => {
  const changed = { ...prefs, proxmox: { ...prefs.proxmox, networkLinks: [...prefs.proxmox.networkLinks, { connectionId: 'c', nodeName: 'pve', bridge: 'vmbr1', vlan: 20 }] } };
  assert.equal(publicSummary(resource, changed, new Date(1)), null);
  assert.deepEqual(publicDetail(resource, { report: { publications: [{ internalAddress: 'private' }] } }, { canReadMikrotik: true }, changed, new Date(1)), { resourceId: 'g', summary: null });
});
test('editing another node does not expire this node report', () => {
  const changed = { ...prefs, proxmox: { networkLinksVersion: 'different-global-version', networkLinks: [...prefs.proxmox.networkLinks, { connectionId: 'c', nodeName: 'other', bridge: 'vmbr9' }] } };
  assert.equal(publicSummary(resource, changed, new Date(1)).hasPublic, true);
});
test('removing last link for a guest VLAN hides old reports even when another VLAN stays', () => {
  const links = [{ connectionId: 'c', nodeName: 'pve', vlan: 10 }, { connectionId: 'c', nodeName: 'pve', vlan: 20 }];
  const previous = { ...resource, exposure: { ...resource.exposure, networkLinksVersion: nodeLinksVersion(links, resource) } };
  const changed = { ...prefs, proxmox: { networkLinks: [links[1]] } };
  assert.equal(publicSummary(previous, changed, new Date(1)), null);
  assert.deepEqual(publicDetail(previous, { report: { publications: [{ linkId: 'removed' }] } }, { canReadMikrotik: true }, changed, new Date(1)), { resourceId: 'g', summary: null });
});
