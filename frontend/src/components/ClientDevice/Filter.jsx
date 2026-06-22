import { useMemo } from "react";

import useClientDeviceFilterStore from "../../store/lists/client-devices";
import { getLocalStorageData } from "../../util/auth";
import {
  STATUS_OPTIONS,
  CUSTOM_VENDOR_BUCKET,
  CUSTOM_VENDOR_LABEL,
} from "./constants";

import Accordion from "react-bootstrap/Accordion";
import AccordionHeader from "react-bootstrap/AccordionHeader";
import Form from "react-bootstrap/Form";

import FilterContainer from "../../UI/FilterContainer";

// Извлекаем уникальные опции {_id, name} из загруженного списка устройств
const uniqueOptions = (items, pick) => {
  const map = new Map();
  items.forEach((item) => {
    const entity = pick(item);
    const id = entity?._id?.toString();
    if (id && !map.has(id)) {
      map.set(id, {
        _id: id,
        name: entity.name || entity.alias || entity.fullTitle || "—",
      });
    }
  });
  return [...map.values()];
};

// Тоггл значения в массиве
const toggle = (arr = [], value) =>
  arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];

const ClientDeviceFilter = () => {
  const filterStore = useClientDeviceFilterStore();
  const items = filterStore.originalList ?? [];
  const list = filterStore.filteredList ?? [];

  // --- Опции, деривируемые из загруженного списка устройств ---
  const companies = useMemo(
    () => uniqueOptions(items, (d) => d.companyId),
    [items],
  );
  const vendors = useMemo(() => {
    const opts = uniqueOptions(items, (d) => d.deviceModelId?.vendorId);
    // Бакет для самосборной техники без модели/вендора.
    if (items.some((d) => !d.deviceModelId)) {
      opts.push({ _id: CUSTOM_VENDOR_BUCKET, name: CUSTOM_VENDOR_LABEL });
    }
    return opts;
  }, [items]);
  const deviceTypes = useMemo(
    () =>
      uniqueOptions(
        items,
        (d) => d.deviceModelId?.deviceTypeId || d.deviceTypeId,
      ),
    [items],
  );
  // Статусы — фиксированный справочник, нормализуем к виду {_id, name}
  const statuses = useMemo(
    () => STATUS_OPTIONS.map((s) => ({ _id: s.value, name: s.label })),
    [],
  );

  // --- Счётчики по текущему отфильтрованному списку ---
  const countBy = {
    company: (id) =>
      list.filter((d) => d.companyId?._id?.toString() === id).length,
    location: (id) =>
      list.filter((d) => d.locationId?._id?.toString() === id).length,
    vendor: (id) =>
      id === CUSTOM_VENDOR_BUCKET
        ? list.filter((d) => !d.deviceModelId).length
        : list.filter((d) => d.deviceModelId?.vendorId?._id?.toString() === id)
            .length,
    deviceType: (id) =>
      list.filter(
        (d) =>
          (
            d.deviceModelId?.deviceTypeId?._id || d.deviceTypeId?._id
          )?.toString() === id,
      ).length,
    status: (id) => list.filter((d) => d.status === id).length,
  };

  // Сортировка: отмеченные сверху, далее по алфавиту
  const sortByChecked = (options, selected = []) =>
    [...options]
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
      .sort((a, b) => {
        const av = selected.includes(a._id);
        const bv = selected.includes(b._id);
        if (av === bv) return 0;
        return av ? -1 : 1;
      });

  const sortedCompanies = useMemo(
    () => sortByChecked(companies, filterStore.companies),
    [companies, filterStore.companies],
  );
  const sortedVendors = useMemo(
    () => sortByChecked(vendors, filterStore.vendors),
    [vendors, filterStore.vendors],
  );
  const sortedDeviceTypes = useMemo(
    () => sortByChecked(deviceTypes, filterStore.deviceTypes),
    [deviceTypes, filterStore.deviceTypes],
  );
  const sortedLocations = useMemo(
    () => sortByChecked(filterStore.locationOptions ?? [], filterStore.locations),
    [filterStore.locationOptions, filterStore.locations],
  );

  // Простые клиентские фильтры (vendors / deviceTypes / statuses / locations)
  const simpleToggle = (key, value) => {
    filterStore.updateFilter({
      ...filterStore,
      [key]: toggle(filterStore[key], value),
    });
    filterStore.applyFilter();
  };

  // Каскад: выбор компании лениво подгружает её локации
  const companyToggleHandler = async (companyId) => {
    const nextCompanies = toggle(filterStore.companies, companyId);

    // Компании не выбраны — сбрасываем опции и выбор локаций
    if (nextCompanies.length === 0) {
      filterStore.updateFilter({
        ...filterStore,
        companies: [],
        locationOptions: [],
        locations: [],
      });
      filterStore.applyFilter();
      return;
    }

    let locationOptions = [];
    try {
      const { token } = getLocalStorageData();
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/inventory/companies-locations?companyIds=${nextCompanies.join(",")}`,
        { headers: { Authorization: "Bearer " + token } },
      );
      if (response.ok) {
        const data = await response.json();
        locationOptions = Array.isArray(data) ? data : [];
      }
    } catch (error) {
      console.error("Не удалось загрузить локации:", error);
    }

    // Отсеиваем выбранные локации, которых больше нет среди опций
    const optionIds = new Set(
      locationOptions.map((l) => l._id?.toString()).filter(Boolean),
    );
    const locations = (filterStore.locations ?? []).filter((id) =>
      optionIds.has(id),
    );

    filterStore.updateFilter({
      ...filterStore,
      companies: nextCompanies,
      locationOptions,
      locations,
    });
    filterStore.applyFilter();
  };

  const resetFilterHandler = () => filterStore.resetFilter();

  // Переиспользуемый рендер чекбоксов раздела
  const renderChecks = (options, { selected = [], onChange, countFn, idPrefix }) =>
    options.map((opt) => {
      const count = countFn(opt._id);
      const isChecked = selected.includes(opt._id);
      return (
        <Form.Check
          key={opt._id}
          type="checkbox"
          id={`${idPrefix}-${opt._id}`}
          checked={isChecked}
          onChange={() => onChange(opt._id)}
          label={`${opt.name} (${count})`}
          className={`py-2 ${isChecked ? "text-info" : ""} ${
            count === 0 ? "text-secondary" : ""
          }`}
        />
      );
    });

  const sectionTitle = (label, count) => (
    <span className={count > 0 ? "text-info" : ""}>
      {label}
      {count > 0 ? ` (${count})` : ""}
    </span>
  );

  const bodyStyle = { maxHeight: "300px", overflowY: "auto" };

  return (
    <FilterContainer resetFilterHandler={resetFilterHandler}>
      {/* Компании */}
      <Accordion className="py-2" defaultActiveKey="0">
        <Accordion.Item eventKey="0">
          <AccordionHeader>
            {sectionTitle("Компании", filterStore.companies?.length)}
          </AccordionHeader>
          <Accordion.Body style={bodyStyle}>
            {renderChecks(sortedCompanies, {
              selected: filterStore.companies,
              onChange: companyToggleHandler,
              countFn: countBy.company,
              idPrefix: "device-company",
            })}
          </Accordion.Body>
        </Accordion.Item>
      </Accordion>

      {/* Локации — только когда выбрана хотя бы одна компания */}
      {filterStore.companies?.length > 0 && (
        <Accordion className="py-2" defaultActiveKey="0">
          <Accordion.Item eventKey="0">
            <AccordionHeader>
              {sectionTitle("Локации", filterStore.locations?.length)}
            </AccordionHeader>
            <Accordion.Body style={bodyStyle}>
              {sortedLocations.length > 0 ? (
                renderChecks(sortedLocations, {
                  selected: filterStore.locations,
                  onChange: (id) => simpleToggle("locations", id),
                  countFn: countBy.location,
                  idPrefix: "device-location",
                })
              ) : (
                <span className="text-secondary">Нет локаций</span>
              )}
            </Accordion.Body>
          </Accordion.Item>
        </Accordion>
      )}

      {/* Производители */}
      <Accordion className="py-2" defaultActiveKey="0">
        <Accordion.Item eventKey="0">
          <AccordionHeader>
            {sectionTitle("Производители", filterStore.vendors?.length)}
          </AccordionHeader>
          <Accordion.Body style={bodyStyle}>
            {renderChecks(sortedVendors, {
              selected: filterStore.vendors,
              onChange: (id) => simpleToggle("vendors", id),
              countFn: countBy.vendor,
              idPrefix: "device-vendor",
            })}
          </Accordion.Body>
        </Accordion.Item>
      </Accordion>

      {/* Типы устройств */}
      <Accordion className="py-2" defaultActiveKey="0">
        <Accordion.Item eventKey="0">
          <AccordionHeader>
            {sectionTitle("Типы устройств", filterStore.deviceTypes?.length)}
          </AccordionHeader>
          <Accordion.Body style={bodyStyle}>
            {renderChecks(sortedDeviceTypes, {
              selected: filterStore.deviceTypes,
              onChange: (id) => simpleToggle("deviceTypes", id),
              countFn: countBy.deviceType,
              idPrefix: "device-type",
            })}
          </Accordion.Body>
        </Accordion.Item>
      </Accordion>

      {/* Статусы */}
      <Accordion className="py-2" defaultActiveKey="0">
        <Accordion.Item eventKey="0">
          <AccordionHeader>
            {sectionTitle("Статусы", filterStore.statuses?.length)}
          </AccordionHeader>
          <Accordion.Body style={bodyStyle}>
            {renderChecks(statuses, {
              selected: filterStore.statuses,
              onChange: (id) => simpleToggle("statuses", id),
              countFn: countBy.status,
              idPrefix: "device-status",
            })}
          </Accordion.Body>
        </Accordion.Item>
      </Accordion>
    </FilterContainer>
  );
};

export default ClientDeviceFilter;
