import { getWorkingStatus } from "../../util/get-working-status";

import { useState, useEffect } from "react";

const WorkingStatusIndicator = ({ workSchedule }) => {
  const useLiveWorkingStatus = (workSchedule) => {
    const [workingStatus, setWorkingStatus] = useState(() =>
      getWorkingStatus(workSchedule),
    );

    useEffect(() => {
      if (workSchedule) {
        const updateStatus = () =>
          setWorkingStatus(getWorkingStatus(workSchedule));

        // Initial update
        updateStatus();

        // Sync with minute mark
        const now = new Date();
        const delay = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();

        const initialTimeout = setTimeout(() => {
          updateStatus();
          const interval = setInterval(updateStatus, 60000);
          return () => clearInterval(interval);
        }, delay);

        return () => clearTimeout(initialTimeout);
      }
    }, [workSchedule]);

    return workingStatus;
  };

  const workingStatus = useLiveWorkingStatus(workSchedule);

  return (
    <span
      className={`${workingStatus.isOpened ? "text-success" : "text-danger"}`}
    >
      {workingStatus.verbose}
    </span>
  );
};

export default WorkingStatusIndicator;
