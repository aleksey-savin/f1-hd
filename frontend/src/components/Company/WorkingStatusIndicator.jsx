import useWorkingStatus from "./useWorkingStatus";

// Легаси-представление живого статуса (bootstrap-классы) — осталось на
// немигрированных экранах (карточка компании, заявка). Мигрированные экраны
// используют tw-двойник WorkStatusText; расчёт общий — useWorkingStatus.
const WorkingStatusIndicator = ({ workSchedule, timezone }) => {
  const workingStatus = useWorkingStatus(workSchedule, timezone);

  return (
    <span
      className={`${workingStatus.isOpened ? "text-success" : "text-danger"}`}
    >
      {workingStatus.verbose}
    </span>
  );
};

export default WorkingStatusIndicator;
