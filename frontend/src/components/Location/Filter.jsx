import { useMemo } from "react";

import useLocationFilterStore from "../../store/lists/locations";
import { getLocalStorageData } from "../../util/auth";

import Accordion from "react-bootstrap/Accordion";
import AccordionHeader from "react-bootstrap/AccordionHeader";
import Form from "react-bootstrap/Form";

import FilterContainer from "../../UI/FilterContainer";

// Фильтр расположений: только по компании, и только одна за раз. Дерево строится
// в пределах выбранной компании, поэтому смешивать несколько нет смысла.
const LocationFilter = ({ companies = [] }) => {
  const filterStore = useLocationFilterStore();
  const selectedCompanyId = filterStore.selectedCompanyIds[0] || null;

  const handleCompanySelect = async (companyId) => {
    // Мгновенно отмечаем выбор, затем подгружаем расположения компании.
    filterStore.setSelectedCompanies([companyId]);

    const { token } = getLocalStorageData();
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/inventory/companies-locations?companyIds=${companyId}`,
        { headers: { Authorization: "Bearer " + token } },
      );
      if (response.ok) {
        const locations = await response.json();
        filterStore.updateFilter({
          originalList: locations,
          selectedCompanyIds: [companyId],
        });
      }
    } catch (error) {
      console.error("Error loading locations:", error);
    }

    const url = new URL(window.location);
    url.searchParams.set("companyIds", companyId);
    window.history.replaceState({}, "", url.pathname + url.search);
  };

  const resetFilterHandler = () => {
    filterStore.resetFilter();
    const url = new URL(window.location);
    url.searchParams.delete("companyIds");
    window.history.replaceState({}, "", url.pathname + url.search);
  };

  const sortedCompanies = useMemo(
    () =>
      [...companies].sort((a, b) =>
        (a.alias || a.fullTitle || "").localeCompare(
          b.alias || b.fullTitle || "",
          "ru",
        ),
      ),
    [companies],
  );

  return (
    <FilterContainer resetFilterHandler={resetFilterHandler}>
      <Form.Check
        type="switch"
        id="show-workplaces"
        className="py-2 mb-1"
        label="Показывать рабочие места"
        checked={filterStore.showWorkplaces}
        onChange={(event) => filterStore.setShowWorkplaces(event.target.checked)}
      />
      {companies.length > 0 && (
        <Accordion className="py-2" defaultActiveKey="0">
          <Accordion.Item eventKey="0">
            <AccordionHeader>
              <span className={selectedCompanyId ? "fw-semibold" : ""}>
                Компания
              </span>
            </AccordionHeader>
            <Accordion.Body
              style={{ height: "calc(100svh - 300px)", overflowY: "auto" }}
            >
              {sortedCompanies.map((company) => {
                const isSelected = selectedCompanyId === company._id;
                return (
                  <Form.Check
                    key={company._id}
                    className={`py-2 ${isSelected ? "fw-semibold" : ""}`}
                    type="radio"
                    name="location-company-filter"
                    id={`company-${company._id}`}
                    checked={isSelected}
                    onChange={() => handleCompanySelect(company._id)}
                    label={company.alias || company.fullTitle}
                  />
                );
              })}
            </Accordion.Body>
          </Accordion.Item>
        </Accordion>
      )}
    </FilterContainer>
  );
};

export default LocationFilter;
