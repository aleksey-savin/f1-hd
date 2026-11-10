const service = require("../services/proxmox/exposure/network-links");
exports.options = async (req, res) =>
  res.json(await service.getNetworkOptions(req.query, { can: req.auth.can }));
exports.detail = async (req, res) => {
  if (req.auth?.isEndUser || !req.auth?.can?.({ proxmox: ["read"] }))
    require("../services/proxmox/policy").fail("Недостаточно прав", 403);
  const { Resource } = require("../models/proxmox");
  const id = require("../services/proxmox/view").validId(req.params.id);
  const resource = await Resource.findOne({
    _id: id,
    kind: "guest",
    archived: false,
  })
    .select("+exposure +exposureGeneration")
    .populate("connectionId", "monitoringEnabled")
    .lean();
  if (!resource)
    require("../services/proxmox/policy").fail("ВМ не найдена", 404);
  const prefs = await require("../models/preferences").findOne({}).lean();
  const { GuestExposure } = require("../models/proxmoxExposure");
  const canReadMikrotik = req.auth.can({ mikrotik: ["read"] });
  const report =
    canReadMikrotik &&
    require("../services/proxmox/exposure/contract").enabled(prefs)
      ? await GuestExposure.findOne({ resourceId: id }).select("+report").lean()
      : null;
  res.json(
    require("../services/proxmox/exposure/view").publicDetail(
      resource,
      report,
      { canReadMikrotik },
      prefs,
    ),
  );
};
