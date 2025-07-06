import useSummaryReportFilterStore from "../../store/finances/report";

import FilterContainer from "../../UI/FilterContainer";

import Accordion from "react-bootstrap/Accordion";
import Form from "react-bootstrap/Form";

const SummaryReportFilter = ({
  setShowOffcanvas = () => {
    return null;
  },
}) => {
  const filterStore = useSummaryReportFilterStore();

  const statusesToggleHandler = (event) => {
    const value = event.target.value;
    filterStore.updateFilter({
      ...filterStore,
      statuses: !filterStore.statuses.includes(value)
        ? [...filterStore.statuses, value]
        : filterStore.statuses.filter((item) => item !== value),
    });
    filterStore.applyFilter();
  };

  const resetFilterHandler = () => {
    filterStore.resetFilter();
  };

  const reportStatusFilter = [
    {
      value: "preview",
      label: "Превью",
      className: `py-2 ${filterStore.statuses?.includes("preview") ? "text-info" : ""}`,
    },
    {
      value: "pendingApproval",
      label: "На утверждении",
      className: `py-2 ${filterStore.statuses?.includes("pendingApproval") ? "text-info" : ""}`,
    },
    {
      value: "approved",
      label: "Ожидает выставления счёта",
      className: `py-2 ${filterStore.statuses?.includes("approved") ? "text-info" : ""}`,
    },
    {
      value: "awaitingPayment",
      label: "Ждём оплаты",
      className: `py-2 ${filterStore.statuses?.includes("awaitingPayment") ? "text-info" : ""}`,
    },
    {
      value: "paid",
      label: "Оплачен",
      className: `py-2 ${filterStore.statuses?.includes("paid") ? "text-info" : ""}`,
    },
  ];

  return (
    <FilterContainer
      setShowOffcanvas={setShowOffcanvas}
      resetFilterHandler={resetFilterHandler}
    >
      <Accordion className="py-2" activeKey="0">
        <Accordion.Item eventKey="0">
          <Accordion.Header>
            <span
              className={`${filterStore.statuses?.length > 0 ? "text-info" : ""}`}
            >
              Статус
            </span>
          </Accordion.Header>
          <Accordion.Body style={{ maxHeight: "100svh", overflowY: "auto" }}>
            {reportStatusFilter.map((item) => {
              return (
                <Form.Check
                  key={item.value}
                  className={item.className}
                  label={`${item.label}`}
                  value={item.value}
                  id={`status-${item.value}`}
                  checked={filterStore.statuses.includes(item.value)}
                  type="checkbox"
                  name="filter-group-statuses"
                  onChange={statusesToggleHandler}
                />
              );
            })}
          </Accordion.Body>
        </Accordion.Item>
      </Accordion>
    </FilterContainer>
  );
};
export default SummaryReportFilter;
