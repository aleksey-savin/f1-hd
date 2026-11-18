import { redirect } from "react-router";
import { SHEET_LG, SHEET_XL } from "@/components/app/FormOutlet";
import ProxmoxList from "./List";
import ProxmoxDetail from "./Detail";
import ConnectionForm from "./ConnectionForm";
import NodeNetworks, {
  nodeNetworksLoader,
  nodeNetworksAction,
} from "./NodeNetworks";
import {
  ROOT,
  action,
  listLoader,
  detailLoader,
  formLoader,
  resourceLoader,
} from "./data";
const gate = (right = "read") => ({
  module: "proxmox",
  can: { proxmox: [right] },
});
export const proxmoxRoutes = [
  {
    path: ROOT.slice(1),
    handle: gate(),
    loader: () => redirect(`${ROOT}/guests`),
  },
  ...["guests", "nodes", "storages", "connections", "companies"].flatMap(
    (kind) => [
      {
        path: `${ROOT.slice(1)}/${kind}`,
        handle: gate(),
        loader: listLoader(kind),
        action,
        element: <ProxmoxList />,
        ...(kind === "connections"
          ? {
              children: [
                {
                  path: "add",
                  handle: {
                    ...gate("manage"),
                    ...SHEET_LG,
                  },
                  loader: formLoader,
                  action,
                  element: <ConnectionForm />,
                },
              ],
            }
          : {}),
      },
      {
        path: `${ROOT.slice(1)}/${kind}/:id`,
        handle: gate(),
        loader: detailLoader(kind),
        action,
        element: <ProxmoxDetail />,
        ...(kind === "nodes"
          ? {
              children: [
                {
                  path: "network-links",
                  handle: {
                    module: "proxmox",
                    can: { proxmox: ["read", "manage"], mikrotik: ["read"] },
                    ...SHEET_LG,
                  },
                  loader: nodeNetworksLoader,
                  action: nodeNetworksAction,
                  element: <NodeNetworks />,
                },
              ],
            }
          : kind === "connections"
            ? {
                children: [
                  {
                    path: "update",
                    handle: { ...gate("manage"), ...SHEET_XL },
                    loader: formLoader,
                    action,
                    element: <ConnectionForm />,
                  },
                ],
              }
            : {}),
      },
    ],
  ),
  {
    path: `${ROOT.slice(1)}/resources/:id`,
    handle: gate(),
    loader: resourceLoader,
  },
  {
    path: `${ROOT.slice(1)}/settings`,
    handle: { can: { settings: ["manage"] } },
    loader: () => redirect("/preferences#proxmox"),
  },
];
