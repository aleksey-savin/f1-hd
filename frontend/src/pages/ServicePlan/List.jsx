import { useEffect } from "react";
import { redirect, useLocation } from "react-router";

import { BrowserView } from "react-device-detect";

import { getLocalStorageData } from "../../util/auth";

import { RiServiceLine } from "react-icons/ri";

import List from "../../components/ServicePlan/List";
import ServicePlanFilter from "../../components/ServicePlan/Filter";

import ListWrapper from "../../UI/ListWrapper";

import useServicePlanFilterStore from "../../store/lists/service-plans";
import useSidebarStore from "../../store/sidebar";

const ServicePlans = () => {
  const location = useLocation();
  const { setLeftSidebarContent } = useSidebarStore();
  const filterStore = useServicePlanFilterStore();

  useEffect(() => {
    if (Array.isArray(filterStore.originalList)) {
      filterStore.applyFilter();
    }
  }, [filterStore.originalList]);

  useEffect(() => {
    filterStore.fetch();
  }, [location]);

  useEffect(() => {
    setLeftSidebarContent(
      <BrowserView>
        <ServicePlanFilter />
      </BrowserView>,
    );
  }, [setLeftSidebarContent, filterStore.originalList]);

  const title = () => {
    return (
      <>
        <RiServiceLine /> Услуги
      </>
    );
  };

  return (
    <ListWrapper
      title={title}
      filter={<ServicePlanFilter />}
      filterStore={filterStore}
      addRoute="/finances/service-plans/add"
    >
      <List items={filterStore.filteredList}></List>
    </ListWrapper>
  );
};

export default ServicePlans;

export async function loader() {
  document.title = "УСЛУГИ";

  return null;
}

export async function action({ request }) {
  const { token } = getLocalStorageData();

  const data = await request.formData();
  const intent = data.get("intent");
  const id = data.get("id");

  if (intent === "delete") {
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/finances/service-plans/delete/${id}`,
      {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
      },
    );

    if ([409].includes(response.status)) {
      return response;
    }

    if (!response.ok) {
      throw response;
    }

    return redirect("/finances/service-plans");
  }
}
