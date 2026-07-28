import { useParams, useRouteLoaderData, useSearchParams } from "react-router";

import ServicePlanForm from "../../components/ServicePlan/Form";

// «Новая услуга» с карточки компании: тот же мастер услуги вложенным маршрутом
// /companies/:id/service-plans/add. Параметры подключения (дата, согласование)
// приезжают query-строкой из диалога «Добавить услугу» (как ?fromTemplate= у
// регламентов), имя компании — из loader'а карточки (route id "company-view").
// Loader и action — прежние от страницы создания услуги: бэкенд получает
// attachCompany в payload и подключает услугу компании одним запросом.
export { loader, action } from "../ServicePlan/Add";

const AddCompanyServicePlanPage = () => {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const parent = useRouteLoaderData("company-view");

  const attach = {
    companyId: id,
    companyAlias: parent?.company?.alias || "компании",
    isActiveSince:
      searchParams.get("isActiveSince") ||
      new Date().toISOString().slice(0, 10),
    customerApprovalRequired: searchParams.get("customerApproval") === "true",
    subdivisionApprovalRequired:
      searchParams.get("subdivisionApproval") === "true",
    approverId: searchParams.get("approver") || null,
  };

  return <ServicePlanForm title="Новая услуга" attach={attach} />;
};

export default AddCompanyServicePlanPage;
