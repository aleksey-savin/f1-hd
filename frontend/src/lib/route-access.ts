import type { AccessRequest, Can } from "./access";

type AccessHandle = { can?: AccessRequest; canAny?: AccessRequest[] };
export const routeAccessAllowed = (handles: AccessHandle[], can: Can) =>
  handles.every(
    (handle) =>
      (!handle.can || can(handle.can)) &&
      (!handle.canAny || handle.canAny.some((request) => can(request))),
  );
