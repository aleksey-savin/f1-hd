import { useContext } from "react";

import ListRow from "@/components/app/ListRow";
import { monogramFor } from "@/components/app/monogram";

import { AuthedUserContext } from "../../store/authed-user-context";
import { plural } from "../../util/plural";

const TicketCategoryItem = ({ item }) => {
  const { title, isActive, alwaysWithinPlan, users, servicePlans } = item;
  const { permissions } = useContext(AuthedUserContext);

  const userCount = users?.length || 0;
  const planCount = servicePlans?.length || 0;
  const showPlans = permissions.canUseFinancesModule;

  const metaParts = [
    userCount > 0
      ? `${userCount} ${plural(userCount, "пользователь", "пользователя", "пользователей")}`
      : "без пользователей",
    showPlans &&
      planCount > 0 &&
      `${planCount} ${plural(planCount, "услуга", "услуги", "услуг")}`,
    alwaysWithinPlan && (
      <span key="plan" className="tw:text-accent-text">
        всегда в рамках тарифа
      </span>
    ),
  ].filter(Boolean);

  return (
    <ListRow
      item={item}
      itemTitle="ticketCategory"
      monogram={monogramFor(title)}
      title={title}
      dimmed={!isActive}
      meta={metaParts.map((part, index) => (
        <span key={index}>
          {index > 0 && " · "}
          {part}
        </span>
      ))}
    />
  );
};

export default TicketCategoryItem;
