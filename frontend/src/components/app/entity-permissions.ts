// Кто может управлять сущностью списка (Изменить/Удалить в «⋯»-меню).
// Матрица перенесена из легаси UI/ItemCard.jsx — используется и карточками,
// и строками списков.
import type { Can } from "@/lib/access";

export function canManageEntity(
  itemTitle: string | undefined,
  can: Can,
  item: { createdBy?: unknown },
  userId?: string,
): boolean {
  switch (itemTitle) {
    case "clientDevice":
    case "deviceModel":
    case "deviceType":
    case "vendor":
    case "supplier":
    case "deviceAttribute":
    case "location":
      return !!can({ clientDevice: ["manage"] });
    case "company":
      return !!can({ company: ["manage"] });
    case "routineTask":
      return !!can({ routineTask: ["manage"] });
    case "servicePlan":
      return !!can({ servicePlan: ["manage"] });
    case "ticket":
      return !!(can({ ticket: ["update"] }) || can({ ticket: ["delete"] }));
    case "ticketCategory":
      return !!can({ ticketCategory: ["manage"] });
    // Шаблоны чек-листов правит тот же, кто администрирует заявки — как и
    // маршрут на бэкенде (routes/internal/checklistTemplate.js)
    case "checklistTemplate":
      return !!can({ ticket: ["administrate"] });
    case "user":
      return !!can({ user: ["manage"] });
    case "role":
      return !!can({ role: ["manage"] });
    case "ticketTemplate":
      return !!(
        can({ ticketTemplate: ["manage"] }) ||
        (item.createdBy != null && String(item.createdBy) === userId)
      );
    default:
      return false;
  }
}
