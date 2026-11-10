const test = require("node:test");
const { beforeEach } = require("node:test");
beforeEach((t) => t.mock.method(require("./monitoring-view"), "enrich", async (items) => items));
const assert = require("node:assert/strict");
const { clusterMetadata } = require("./core");
const { view, list } = require("./view");
const { Resource } = require("../../models/proxmox");
test("cluster metadata distinguishes confirmed standalone from unknown and uses real name", () => {
  assert.deepEqual(clusterMetadata(null), {});
  assert.deepEqual(clusterMetadata([]), {});
  assert.deepEqual(clusterMetadata([{ type: "node", name: "pve" }]), {
    isCluster: false,
    clusterName: null,
  });
  assert.deepEqual(clusterMetadata([{ type: "cluster", name: "production" }]), {
    isCluster: true,
    clusterName: "production",
  });
  assert.deepEqual(
    view({
      kind: "node",
      connectionId: {
        _id: "c",
        name: "Not cluster",
        isCluster: true,
        clusterName: "Real cluster",
      },
    }).cluster,
    { id: "c", name: "Real cluster" },
  );
  assert.equal(
    view({ kind: "node", connectionId: { _id: "c", name: "Not cluster" } })
      .isCluster,
    null,
  );
  assert.equal(
    view({ kind: "node", connectionId: { _id: "c", isCluster: false } })
      .cluster,
    null,
  );
});
test("node facets include all company nodes regardless of page/search/status and selected cluster", async () => {
  const original = Resource.find,
    count = Resource.countDocuments,
    queries = [];
  const company = "64aa00000000000000000001",
    c1 = "64aa00000000000000000002",
    c2 = "64aa00000000000000000003";
  const all = Array.from({ length: 105 }, () => ({
    connectionId: { _id: c1, isCluster: true, clusterName: "Actual" },
  })).concat([
    { connectionId: { _id: c2, isCluster: false } },
    { connectionId: { _id: "64aa00000000000000000004" } },
  ]);
  Resource.find = (filter) => {
    const call = { filter };
    queries.push(call);
    const q = {
      select() {
        call.facet = true;
        return q;
      },
      populate() {
        return q;
      },
      sort() {
        return q;
      },
      skip(n) {
        call.skip = n;
        return q;
      },
      limit(n) {
        call.limit = n;
        return q;
      },
      lean: async () => (call.facet ? all : []),
    };
    return q;
  };
  Resource.countDocuments = async (filter) => {
    assert.equal(filter.companyId, company);
    assert.deepEqual(filter.connectionId, { $in: [c2] });
    return 1;
  };
  try {
    const result = await list("nodes", {
      companyId: company,
      clusterId: "standalone",
      page: 3,
      pageSize: 1,
      search: "node",
      status: "online",
    });
    assert.deepEqual(queries[0].filter, {
      kind: "node",
      archived: false,
      companyId: company,
    });
    assert.equal(queries[0].limit, undefined);
    assert.equal(queries[1].skip, 2);
    assert.equal(result.total, 1);
    assert.deepEqual(result.facets.clusters, [
      { value: c1, label: "Actual", count: 105 },
      { value: "standalone", label: "Вне кластера", count: 1 },
      { value: "unknown", label: "Кластер не определён", count: 1 },
    ]);
  } finally {
    Resource.find = original;
    Resource.countDocuments = count;
  }
});
