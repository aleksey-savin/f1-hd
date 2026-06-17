import { Table } from "react-bootstrap";
import AlertMessage from "../../../UI/AlertMessage";

import { RiTimeLine } from "react-icons/ri";

import { useLoaderData } from "react-router";

import WorkingStatusIndicator from "../WorkingStatusIndicator";

const WEEKDAYS = {
  Monday: "Понедельник",
  Tuesday: "Вторник",
  Wednesday: "Среда",
  Thursday: "Четверг",
  Friday: "Пятница",
  Saturday: "Суббота",
  Sunday: "Воскресенье",
};

const WorkScheduleRow = ({ day, schedule }) => (
  <tr>
    <td>{day}</td>
    <td>{schedule?.start || "-"}</td>
    <td>{schedule?.end || "-"}</td>
    <td>{schedule?.is24hours ? "круглосуточно" : ""}</td>
  </tr>
);

const WorkScheduleTable = ({ workSchedule }) => (
  <Table responsive striped className="mb-0">
    <thead>
      <tr>
        <th>День недели</th>
        <th>Начало</th>
        <th>Окончание</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      {Object.entries(WEEKDAYS).map(([key, day]) => (
        <WorkScheduleRow key={key} day={day} schedule={workSchedule[key]} />
      ))}
    </tbody>
  </Table>
);

const WorkSchedule = () => {
  const { company } = useLoaderData();
  const { workSchedule } = company;

  return (
    <>
      <div className="cap-card-title mb-3">
        <RiTimeLine />
        <span>График работы</span>
      </div>
      <div className="mb-3">
        <WorkingStatusIndicator workSchedule={workSchedule} />
      </div>
      {!workSchedule ? (
        <AlertMessage variant="light" message="Не указан" />
      ) : (
        <WorkScheduleTable workSchedule={workSchedule} />
      )}
    </>
  );
};

export default WorkSchedule;
