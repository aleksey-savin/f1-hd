import Select from "../../../UI/Select";

// Селектор появляется только у isAdmin/canSeeGlobalFinancialReport:
// loader получает 403 на списке сотрудников и передаёт employees = null
const EmployeePicker = ({ employees, selfId, value, onChange }) => {
  const options = [
    { value: "", label: "Мой отчёт" },
    ...employees
      .filter((employee) => employee._id !== selfId)
      .map((employee) => ({
        value: employee._id,
        label:
          `${employee.lastName} ${employee.firstName}`.trim() +
          (employee.position ? ` · ${employee.position}` : ""),
      })),
  ];

  const selected =
    options.find((option) => option.value === (value || "")) || options[0];

  return (
    <Select
      options={options}
      value={selected}
      onChange={(option) => onChange(option?.value || null)}
      isSearchable
      placeholder="Сотрудник"
      aria-label="Сотрудник"
    />
  );
};

export default EmployeePicker;
