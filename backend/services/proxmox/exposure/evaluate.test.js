const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateTargets, summaryOf } = require("./evaluate");
const {normalizeRouter}=require('./router-rules');
const {LIMITS}=require('./contract');
test("unknown address coverage prevents a clean negative and an unavailable second router preserves a fresh positive", () => {
  const now = new Date(0);
  let report = evaluateTargets(
    {
      guestTargets: { targets: [], unresolved: [{ code: "networkUnmatched" }] },
      routerSnapshots: [],
      links: [],
    },
    now,
  );
  assert.equal(summaryOf(report, null, now).state, "unmatched");
  report = {
    coverage: [
      {
        state: "public",
        hasPublic: true,
        publishedCount: 1,
        checkedAt: now,
        freshUntil: new Date(900000),
        lastAttemptOk: true,
      },
      { state: "unknown", unknownCount: 1, lastAttemptOk: false },
    ],
    publications: [],
    sources: [],
  };
  assert.equal(summaryOf(report, null, new Date(1)).hasPublic, true);
  assert.equal(summaryOf(report, null, new Date(900000)).hasPublic, false);
});
test('per-guest work is bounded even when many targets yield no NAT candidates',()=>{
 const link={_id:'l',routerId:'r',lanInterface:'bridge',wan:{kind:'interface',name:'wan'}};
 const targets=Array.from({length:LIMITS.FRAGMENTS+2},(_,i)=>({address:`10.0.${Math.floor(i/256)}.${i%256}`,link,networkCheckedAt:new Date(0)}));
 const report=evaluateTargets({guestTargets:{targets,unresolved:[]},routerSnapshots:[{routerId:'r',status:'fresh',checkedAt:new Date(0),data:normalizeRouter({nat:[]})}]},new Date(1));
 assert.ok(report.coverage.length<=LIMITS.FRAGMENTS+1);assert.ok(summaryOf(report,null,new Date(1)).reasonCodes.includes('analysisLimit'));
});
