import { useMemo } from "react";

import useLocationFilterStore from "../../store/lists/locations";
import { getLocalStorageData } from "../../util/auth";

import Accordion from "react-bootstrap/Accordion";
import AccordionHeader from "react-bootstrap/AccordionHeader";
import Form from "react-bootstrap/Form";

import FilterContainer from "../../UI/FilterContainer";

const LocationFilter = ({ companies = [] }) => {
  const filterStore = useLocationFilterStore();

  const locationTypes = [
    { value: "building", label: "Здания" },
    { value: "floor", label: "Этажи" },
    { value: "room", label: "Помещения" },
    { value: "workplace", label: "Рабочие места" },
    { value: "storage", label: "Склад" },
  ];

  // Handle company selection change (multiple selection)
  const handleCompanyToggle = async (companyId) => {
    const isCurrentlySelected =
      filterStore.selectedCompanyIds.includes(companyId);

    // Toggle company selection first
    filterStore.toggleCompany(companyId);

    // Get updated company list after toggle
    const newSelectedCompanies = isCurrentlySelected
      ? filterStore.selectedCompanyIds.filter((id) => id !== companyId)
      : [...filterStore.selectedCompanyIds, companyId];

    // Load locations for all selected companies
    if (newSelectedCompanies.length > 0) {
      const { token } = getLocalStorageData();
      try {
        const companyIdsParam = newSelectedCompanies.join(",");
        const response = await fetch(
          `${import.meta.env.VITE_API_ADDRESS}/api/inventory/companies-locations?companyIds=${companyIdsParam}`,
          {
            headers: {
              Authorization: "Bearer " + token,
            },
          },
        );

        if (response.ok) {
          const allLocations = await response.json();

          filterStore.updateFilter({
            originalList: allLocations,
            selectedCompanyIds: newSelectedCompanies,
          });
        }
      } catch (error) {
        console.error("Error loading locations:", error);
      }
    } else {
      // No companies selected, clear locations
      filterStore.updateFilter({
        originalList: [],
        selectedCompanyIds: [],
      });
    }

    // Update URL to persist company selection
    const url = new URL(window.location);
    if (newSelectedCompanies.length > 0) {
      url.searchParams.set("companyIds", newSelectedCompanies.join(","));
    } else {
      url.searchParams.delete("companyIds");
    }
    window.history.replaceState({}, "", url.pathname + url.search);
  };

  // Handle type filter change
  const handleTypeFilterChange = (type) => {
    const newFilterType = filterStore.filterType === type ? "all" : type;
    filterStore.setFilterType(newFilterType);
  };

  const resetFilterHandler = () => {
    filterStore.resetFilter();
    // Clear URL parameters
    const url = new URL(window.location);
    url.searchParams.delete("companyIds");
    window.history.replaceState({}, "", url.pathname + url.search);
  };

  // Get location count by type for current filtered list
  const getLocationCountByType = (type) => {
    return filterStore.originalList.filter((location) => location.type === type)
      .length;
  };

  // Sort companies by selected state and alphabetically
  const sortedCompanies = useMemo(() => {
    return [...companies]
      .sort((a, b) =>
        (a.alias || a.fullTitle).localeCompare(b.alias || b.fullTitle),
      )
      .sort((a, b) => {
        const aSelected = filterStore.selectedCompanyIds.includes(a._id);
        const bSelected = filterStore.selectedCompanyIds.includes(b._id);
        if (aSelected === bSelected) return 0;
        return aSelected ? -1 : 1;
      });
  }, [companies, filterStore.selectedCompanyIds]);

  return (
    <FilterContainer resetFilterHandler={resetFilterHandler}>
      {/* Company Selection */}
      {companies.length > 0 && (
        <Accordion className="py-2" defaultActiveKey="0">
          <Accordion.Item eventKey="0">
            <AccordionHeader>
              <span
                className={`${filterStore.selectedCompanyIds.length > 0 ? "text-info" : ""}`}
              >
                Компании{" "}
                {filterStore.selectedCompanyIds.length > 0 &&
                  `(${filterStore.selectedCompanyIds.length})`}
              </span>
            </AccordionHeader>
            <Accordion.Body style={{ maxHeight: "300px", overflowY: "auto" }}>
              {sortedCompanies.map((company) => {
                const totalLocations = filterStore.originalList.filter(
                  (location) => location.company?._id === company._id,
                ).length;
                const isSelected = filterStore.selectedCompanyIds.includes(
                  company._id,
                );
                return (
                  <Form.Check
                    key={company._id}
                    className={`py-2 ${isSelected ? "text-info" : ""}`}
                    type="checkbox"
                    id={`company-${company._id}`}
                    checked={isSelected}
                    onChange={() => handleCompanyToggle(company._id)}
                    label={
                      <div className="d-flex justify-content-between align-items-center w-100">
                        <span className="pe-1">
                          {company.alias || company.fullTitle}
                        </span>
                        {totalLocations > 0 && (
                          <span className="badge bg-secondary">
                            {totalLocations}
                          </span>
                        )}
                      </div>
                    }
                  />
                );
              })}
            </Accordion.Body>
          </Accordion.Item>
        </Accordion>
      )}

      {/* Location Type Filters */}
      {filterStore.selectedCompanyIds.length > 0 &&
        filterStore.originalList.length > 0 && (
          <Accordion className="py-2 mb-2" defaultActiveKey="0">
            <Accordion.Item eventKey="0">
              <AccordionHeader>
                <span
                  className={`${filterStore.filterType !== "all" ? "text-info" : ""}`}
                >
                  Тип расположения
                </span>
              </AccordionHeader>
              <Accordion.Body>
                <Form.Check
                  className={`py-2 ${filterStore.filterType === "all" ? "text-info" : ""}`}
                  checked={filterStore.filterType === "all"}
                  label={`Все типы (${filterStore.originalList.length})`}
                  value="all"
                  id="type-all"
                  type="radio"
                  name="filter-group-type"
                  onChange={() => filterStore.setFilterType("all")}
                />
                {locationTypes.map((type) => {
                  const count = getLocationCountByType(type.value);
                  return (
                    <Form.Check
                      key={type.value}
                      className={`py-2 ${
                        filterStore.filterType === type.value ? "text-info" : ""
                      }`}
                      checked={filterStore.filterType === type.value}
                      label={
                        <>
                          {type.label} ({count})
                        </>
                      }
                      value={type.value}
                      id={`type-${type.value}`}
                      type="radio"
                      name="filter-group-type"
                      onChange={() => handleTypeFilterChange(type.value)}
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
