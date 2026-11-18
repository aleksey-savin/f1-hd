const test = require("node:test");
const assert = require("node:assert/strict");
const controller = require("../../controllers/proxmoxExposure");
const { Resource } = require("../../models/proxmox");
const Preferences = require("../../models/preferences");
const { GuestExposure } = require("../../models/proxmoxExposure");
test("detail denies end users before storage and reads no private report without MikroTik rights", async (t) => {
  await assert.rejects(
    controller.detail(
      { auth: { isEndUser: true, can: () => true }, params: {} },
      {},
    ),
    (e) => e.statusCode === 403 || e.status === 403,
  );
  const query = {
    select() {
      return this;
    },
    populate() {
      return this;
    },
    lean: async () => ({
      _id: "64aa00000000000000000001",
      kind: "guest",
      connectionId: { monitoringEnabled: true },
    }),
  };
  t.mock.method(Resource, "findOne", () => query);
  t.mock.method(Preferences, "findOne", () => ({
    lean: async () => ({
      modules: { proxmox: { isActive: true }, mikrotik: { isActive: true } },
      proxmox: { networkLinks: [] },
    }),
  }));
  t.mock.method(GuestExposure, "findOne", () =>
    assert.fail("private collection must not be read"),
  );
  let dto;
  await controller.detail(
    {
      params: { id: "64aa00000000000000000001" },
      auth: { can: (request) => !!request.proxmox },
    },
    { json: (value) => (dto = value) },
  );
  assert.equal(dto.summary, null);
  assert.equal(dto.publications, undefined);
  assert.equal(dto.sources, undefined);
});
test('node read, save and catalog endpoints reject end users and each missing permission before storage',async(t)=>{
 t.mock.method(Resource,'findOne',()=>assert.fail('denied request must not read node'));
 for(const handler of [controller.nodeLinks,controller.saveNodeLinks,controller.nodeOptions]) {
  for(const auth of [{isEndUser:true,can:()=>true},...['read','manage','mikrotik'].map(denied=>({can:rights=>denied==='mikrotik'?!rights.mikrotik:!rights.proxmox?.includes(denied)}))])
   await assert.rejects(handler({params:{id:'64aa00000000000000000001'},query:{},body:{},auth},{json:()=>assert.fail()}),e=>e.status===403||e.statusCode===403);
 }
});
