export type AccessSnapshot = { userId: string; version: string };

export const accessChanged = (
  user: { _id: string; accessVersion?: string },
  access: AccessSnapshot | null,
): boolean => Boolean(
  access?.version && access.userId === user._id &&
  user.accessVersion !== access.version,
);
