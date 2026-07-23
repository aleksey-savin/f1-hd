import useWorkingStatus from "./useWorkingStatus";

// Легаси-представление живого статуса (bootstrap-классы) — осталось на
// немигрированных экранах (карточка компании, заявка). Мигрированные экраны
// используют tw-двойник WorkStatusText; расчёт общий — useWorkingStatus.
const WorkingStatusIndicator = ({ workSchedule }) => {
  const workingStatus = useWorkingStatus(workSchedule);

  return (
    <span
      className={`${workingStatus.isOpened ? "text-success" : "text-danger"}`}
    >
      {workingStatus.verbose}
    </span>
  );
};

export default WorkingStatusIndicator;
