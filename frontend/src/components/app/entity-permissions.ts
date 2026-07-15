// Кто может управлять сущностью списка (Изменить/Удалить в «⋯»-меню).
// Матрица перенесена из легаси UI/ItemCard.jsx — используется и карточками,
// и строками списков.
type Permissions = Record<string, boolean>;

export function canManageEntity(
  itemTitle: string | undefined,
  permissions: Permissions,
  item: { createdBy?: unknown },
  userId?: string,
): boolean {
  switch (itemTitle) {
    case "clientDevice":
    case "deviceModel":
    case "deviceType":
    case "vendor":
    case "deviceAttribute":
    case "location":
      return !!permissions.canManageClientDevices;
    case "company":
      return !!permissions.canManageCompanies;
    case "routineTask":
      return !!permissions.canManageRoutineTasks;
    case "servicePlan":
      return !!permissions.canManageServicePlans;
    case "ticket":
      return !!(permissions.canEditTickets || permissions.canDeleteTickets);
    case "ticketCategory":
      return !!permissions.canManageTicketCategories;
    case "user":
      return !!permissions.canManageUsers;
    case "ticketTemplate":
      return !!(
        permissions.canManageTicketTemplates ||
        (item.createdBy != null && String(item.createdBy) === userId)
      );
    default:
      return false;
  }
}
