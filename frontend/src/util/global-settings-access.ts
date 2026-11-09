import type { Can, AccessRequest } from "@/lib/access";

export const GLOBAL_SETTINGS_ACCESS: AccessRequest[] = [
  { settings: ["manage"] },
  { taxi: ["configure"] },
];
export const canOpenGlobalSettings = (can: Can) =>
  GLOBAL_SETTINGS_ACCESS.some((request) => can(request));
