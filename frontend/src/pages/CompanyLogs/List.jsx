import { useEffect, useContext } from "react";
import { useLocation, useParams, useLoaderData } from "react-router";

import { BrowserView } from "react-device-detect";

import { RiHistoryLine } from "react-icons/ri";

import List from "../../components/CompanyLogs/List";
import CompanyLogsFilter from "../../components/CompanyLogs/Filter";

import ListWrapper from "../../UI/ListWrapper";

import useCompanyLogsFilterStore from "../../store/lists/companyLogs";
import useSidebarStore from "../../store/sidebar";
import { AuthedUserContext } from "../../store/authed-user-context";

import { getLocalStorageData } from "../../util/auth";

const CompanyLogsPage = () => {
  const location = useLocation();
  const params = useParams();
  const { company } = useLoaderData();
  const { permissions } = useContext(AuthedUserContext);
  const { setLeftSidebarContent } = useSidebarStore();
  const filterStore = useCompanyLogsFilterStore();

  useEffect(() => {
    if (params.companyId) {
      filterStore.setCompanyId(params.companyId);
    }
  }, [params.companyId]);

  useEffect(() => {
    filterStore.applyFilter();
    filterStore.handleSorting(filterStore.sortBy);
  }, [filterStore.originalList]);

  useEffect(() => {
    if (filterStore.companyId) {
      filterStore.fetch();
    }
  }, [location, filterStore.companyId]);

  useEffect(() => {
    setLeftSidebarContent(
      <BrowserView>
        <CompanyLogsFilter />
      </BrowserView>,
    );
  }, [setLeftSidebarContent, filterStore.originalList]);

  const title = () => {
    return (
      <>
        <RiHistoryLine /> Логи активности
      </>
    );
  };

  return (
    <ListWrapper
      title={title}
      filter={<CompanyLogsFilter />}
      filterStore={filterStore}
      showAddButton={false}
      showBackButton={true}
      backRoute={`/companies/${params.companyId}`}
    >
      <List
        items={filterStore.filteredList}
        company={company}
        permissions={permissions}
      />
    </ListWrapper>
  );
};

export default CompanyLogsPage;

export async function loader({ params }) {
  const { token } = getLocalStorageData();

  // Загружаем информацию о компании для передачи в компоненты
  const companyResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/companies/${params.companyId}`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );

  if (!companyResponse.ok) {
    throw companyResponse;
  }

  const companyData = await companyResponse.json();

  document.title = `ЛОГИ АКТИВНОСТИ - ${companyData.company.alias}`;

  return {
    company: companyData.company,
  };
}

export async function action({ request }) {
  const { token } = getLocalStorageData();

  const data = await request.formData();
  const intent = data.get("intent");

  if (intent === "linkUserToAD") {
    const logId = data.get("logId");
    const userId = data.get("userId");

    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/companies/link-user-to-ad`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({
          logId,
          userId,
        }),
      },
    );

    if ([409].includes(response.status)) {
      return response;
    }

    if (!response.ok) {
      throw response;
    }

    return response;
  }
}
