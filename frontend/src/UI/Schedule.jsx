import { useState } from "react";

import Form from "react-bootstrap/Form";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";

const Schedule = ({ existingSchedule = [] }) => {
  const daysInRussian = {
    Понедельник: "Monday",
    Вторник: "Tuesday",
    Среда: "Wednesday",
    Четверг: "Thursday",
    Пятница: "Friday",
    Суббота: "Saturday",
    Воскресенье: "Sunday",
  };

  const initialSchedule = Object.fromEntries(
    Object.values(daysInRussian).map((day) => [
      day,
      { isWorking: false, is24hours: false, start: "09:00", end: "18:00" },
    ]),
  );

  const formatExistingSchedule = (existingSchedule) => {
    return Object.fromEntries(
      Object.values(daysInRussian).map((day) => [
        day,
        existingSchedule && existingSchedule[day]
          ? {
              isWorking: Boolean(existingSchedule[day].isWorking),
              is24hours: Boolean(existingSchedule[day].is24hours),
              start: existingSchedule[day].start || "",
              end: existingSchedule[day].end || "",
            }
          : {
              isWorking: false,
              is24hours: false,
              start: "09:00",
              end: "18:00",
            },
      ]),
    );
  };

  const [schedule, setSchedule] = useState(
    formatExistingSchedule(existingSchedule) || initialSchedule,
  );

  const handleCheckboxChange = (day) => {
    setSchedule((prevSchedule) => ({
      ...prevSchedule,
      [day]: { ...prevSchedule[day], isWorking: !prevSchedule[day].isWorking },
    }));
  };

  const handleSwitchChange = (day) => {
    setSchedule((prevSchedule) => ({
      ...prevSchedule,
      [day]: {
        ...prevSchedule[day],
        start: "",
        end: "",
        is24hours: !prevSchedule[day].is24hours,
      },
    }));
  };

  const handleTimeChange = (day, field, value) => {
    setSchedule((prevSchedule) => ({
      ...prevSchedule,
      [day]: { ...prevSchedule[day], [field]: value },
    }));
  };

  return (
    <Form.Group>
      {Object.entries(daysInRussian).map(([russianDay, englishDay]) => {
        const { isWorking, is24hours, start, end } = schedule[englishDay];
        return (
          <Row key={englishDay} className="py-2">
            <Col xl="3">
              <Form.Check
                id={englishDay}
                type="checkbox"
                name={`${englishDay}.isWorking`}
                className={`${!isWorking ? "text-secondary" : ""}`}
                label={russianDay}
                checked={isWorking}
                onChange={() => handleCheckboxChange(englishDay)}
              />
            </Col>
            {isWorking && (
              <>
                <Col sm="3">
                  <Form.Control
                    type="time"
                    disabled={is24hours}
                    name={`${englishDay}.start`}
                    value={start}
                    onChange={(e) =>
                      handleTimeChange(englishDay, "start", e.target.value)
                    }
                  />
                </Col>
                <Col sm="3">
                  <Form.Control
                    type="time"
                    disabled={is24hours}
                    name={`${englishDay}.end`}
                    value={end}
                    onChange={(e) =>
                      handleTimeChange(englishDay, "end", e.target.value)
                    }
                  />
                </Col>
                <Col sm="3">
                  <Form.Check
                    type="switch"
                    label="24 часа"
                    name={`${englishDay}.is24hours`}
                    checked={is24hours}
                    onChange={() => handleSwitchChange(englishDay)}
                  />
                </Col>
              </>
            )}
          </Row>
        );
      })}
    </Form.Group>
  );
};

export default Schedule;
