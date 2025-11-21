import { useEffect } from "react";
import { useLocation, useLoaderData, useActionData } from "react-router";

import { BrowserView } from "react-device-detect";

import { RiMapPinLine } from "react-icons/ri";

import List from "../../components/Location/List";
import LocationFilter from "../../components/Location/Filter";

import ListWrapper from "../../UI/ListWrapper";
import Card from "react-bootstrap/Card";
import Container from "react-bootstrap/Container";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Alert from "react-bootstrap/Alert";

import useLocationFilterStore from "../../store/lists/locations";
import useSidebarStore from "../../store/sidebar";
import { getLocalStorageData } from "../../util/auth";

const LocationList = () => {
  const appLocation = useLocation();
  const loaderData = useLoaderData();
  const actionData = useActionData();
  const { setLeftSidebarContent } = useSidebarStore();
  const filterStore = useLocationFilterStore();

  const companies = loaderData?.companies || [];

  useEffect(() => {
    filterStore.applyFilter();
    filterStore.handleSorting(filterStore.sortBy);
  }, [filterStore.originalList]);

  useEffect(() => {
    filterStore.fetch();
  }, [appLocation]);

  // Initialize selected companies from URL params (only once)
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const companyIds = urlParams.get("companyIds");

    if (companies.length > 0 && filterStore.selectedCompanyIds.length === 0) {
      if (companyIds) {
        const idsArray = companyIds.split(",").filter(Boolean);
        filterStore.setSelectedCompanies(idsArray);
      }
    }
  }, [companies.length, appLocation]);

  // Set sidebar content
  useEffect(() => {
    setLeftSidebarContent(
      <BrowserView>
        <LocationFilter companies={companies} />
      </BrowserView>,
    );
  }, [setLeftSidebarContent, filterStore.originalList, companies]);

  const title = () => {
    return (
      <>
        <RiMapPinLine /> Расположения
      </>
    );
  };

  // Show error if any
  if (loaderData?.error) {
    return (
      <Container fluid>
        <Row className="mb-4">
          <Col>
            <Alert variant="danger">
              <strong>Ошибка:</strong> {loaderData.error}
            </Alert>
          </Col>
        </Row>
      </Container>
    );
  }

  // Action Data Messages
  const ActionMessages = () => (
    <>
      {actionData?.error && (
        <Row className="mb-4">
          <Col>
            <Alert variant="danger" dismissible>
              <strong>Ошибка:</strong> {actionData.error}
            </Alert>
          </Col>
        </Row>
      )}
      {actionData?.success && (
        <Row className="mb-4">
          <Col>
            <Alert variant="success" dismissible>
              {actionData.success}
            </Alert>
          </Col>
        </Row>
      )}
    </>
  );

  // Show company selection prompt if no companies selected
  if (
    !filterStore.selectedCompanyIds ||
    filterStore.selectedCompanyIds.length === 0
  ) {
    return (
      <ListWrapper title={title} filterStore={filterStore}>
        <ActionMessages />
        <Card className="text-center py-5">
          <Card.Body>
            <RiMapPinLine size={48} className="text-muted mb-3" />
            <h5 className="text-muted">Выберите компании</h5>
            <p className="text-muted">
              Для просмотра расположений выберите одну или несколько компаний из
              списка в левой боковой панели. Доступно компаний:{" "}
              {companies.length}
            </p>
          </Card.Body>
        </Card>
      </ListWrapper>
    );
  }

  return (
    <Container fluid>
      <ActionMessages />
      <ListWrapper
        title={title}
        filter={<LocationFilter />}
        filterStore={filterStore}
        addRoute={`/inventory/locations/add?company=${filterStore.selectedCompanyIds[0] || ""}`}
      >
        <List items={filterStore.filteredList} />
      </ListWrapper>
    </Container>
  );
};

// React Router Loader
export const loader = async ({ request }) => {
  const { token } = getLocalStorageData();
  const url = new URL(request.url);
  const companyIds = url.searchParams.get("companyIds");
  const companyId = url.searchParams.get("companyId"); // Support old format

  try {
    // Always load companies
    const companiesResponse = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/companies`,
      {
        headers: {
          Authorization: "Bearer " + token,
        },
      },
    );

    const companies = companiesResponse.ok
      ? await companiesResponse.json()
      : [];

    let locations = [];

    // Load locations if companies are selected
    if (companyIds || companyId) {
      let queryParams = "";
      if (companyIds) {
        // Multiple companies: "companyId1,companyId2,companyId3"
        queryParams = `companyIds=${companyIds}`;
      } else if (companyId) {
        // Single company (backwards compatibility)
        queryParams = `companyId=${companyId}`;
      }

      const locationsResponse = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/inventory/companies-locations?${queryParams}`,
        {
          headers: {
            Authorization: "Bearer " + token,
          },
        },
      );

      if (locationsResponse.ok) {
        locations = await locationsResponse.json();
      }
    }

    return { companies, locations };
  } catch (error) {
    console.error("Error in locations loader:", error);
    return { companies: [], locations: [], error: error.message };
  }
};

// React Router Action
export const action = async ({ request }) => {
  const { token } = getLocalStorageData();
  const formData = await request.formData();
  const intent = formData.get("intent");

  try {
    switch (intent) {
      case "delete": {
        const locationId = formData.get("id");

        if (!locationId) {
          throw new Error("ID расположения не указан");
        }

        const response = await fetch(
          `${import.meta.env.VITE_API_ADDRESS}/api/inventory/locations/delete/${locationId}`,
          {
            method: "POST",
            headers: {
              Authorization: "Bearer " + token,
              "Content-Type": "application/json",
            },
          },
        );

        if (!response.ok) {
          let errorMessage = "Ошибка при удалении расположения";
          try {
            const errorData = await response.json();
            errorMessage = errorData.message || errorMessage;
          } catch {
            errorMessage = `HTTP ${response.status}: ${response.statusText}`;
          }
          throw new Error(errorMessage);
        }

        return { success: "Расположение успешно удалено" };
      }

      default:
        throw new Error("Неизвестное действие");
    }
  } catch (error) {
    console.error("Error in locations action:", error);
    return { error: error.message };
  }
};

export default LocationList;
