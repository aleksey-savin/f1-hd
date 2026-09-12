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
    case "location":
      return !!can({ device: ["manage"] });
    // Справочники и поставщики — свои права: раздать поставщиков, не раздавая
    // всю технику клиентов, теперь можно
    case "deviceModel":
    case "deviceType":
    case "vendor":
    case "deviceAttribute":
      return !!can({ inventoryCatalog: ["manage"] });
    case "supplier":
      return !!can({ supplier: ["manage"] });
    case "company":
      return !!can({ company: ["manage"] });
    case "routineTask":
      return !!can({ routineTask: ["manage"] });
    case "servicePlan":
      return !!can({ servicePlan: ["manage"] });
    case "ticket":
      return !!(can({ ticket: ["manage"] }) || can({ ticket: ["delete"] }));
    case "ticketCategory":
      return !!can({ ticketCategory: ["manage"] });
    // У шаблонов чек-листов своё право — как и на маршруте
    // (routes/internal/checklistTemplate.js)
    case "checklistTemplate":
      return !!can({ checklistTemplate: ["manage"] });
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
