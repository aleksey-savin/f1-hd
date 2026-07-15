import { RiFileList2Line } from "react-icons/ri";

import ListRow from "@/components/app/ListRow";

import { tariffTypeName } from "./tariff-types";

const ServicePlanItem = ({ item }) => {
  const { title, type, companies = [] } = item;

  const aliases = companies
    .map((company) => company.alias)
    .filter(Boolean)
    .join(", ");
  const metaParts = [tariffTypeName(type), aliases].filter(Boolean);

  return (
    <ListRow
      item={item}
      itemTitle="servicePlan"
      // Клик по услуге открывает карточку (View), а не шторку правки
      detailTo={item._id}
      monogram={<RiFileList2Line />}
      title={title}
      meta={metaParts.join(" · ")}
    />
  );
};

export default ServicePlanItem;
