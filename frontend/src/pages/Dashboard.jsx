import { useContext } from "react";
import { redirect, useLoaderData } from "react-router";
import pad from "pad";

import { getLocalStorageData } from "../util/auth";

import { AuthedUserContext } from "../store/authed-user-context";
import useInitialPrefsStore from "../store/prefs";

import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import ProgressBar from "react-bootstrap/ProgressBar";
import Tab from "react-bootstrap/Tab";
import Tabs from "react-bootstrap/Tabs";

import Transitions from "../animations/Transition";
import { formatMonth } from "../util/format-date";

import { IoIosStats } from "react-icons/io";
import { FaTasks } from "react-icons/fa";

import TaskCard from "../components/Dashboard/TaskCard";
import WorksCard from "../components/Dashboard/WorksCard";
import DashboardCalendar from "../components/Dashboard/Calendar";
import Actions from "../components/Dashboard/Actions";
import TicketsPanel from "../layout/Dashboard/TicketsPanel";

const Dashboard = () => {
  const { dashboard: dashboardPrefs, _id: userId } =
    useContext(AuthedUserContext);
  const { modules } = useInitialPrefsStore();
  const { summary, tickets, scheduledWorks, responsibles } = useLoaderData();

  const {
    globalActions,
    globalTasks,
    globalStats,
    personalActions,
    personalTasks,
    personalStats,
  } = dashboardPrefs;

  let clientsMaxTotalTime = null;
  let specsMaxTotalTime = null;

  if (globalStats) {
    clientsMaxTotalTime = summary.clientsWorksReport[0]?.totalTime;
    specsMaxTotalTime = summary.specsWorksReport[0]?.totalTime;
  }

  const msToHMS = (ms) => {
    // 1- Convert to seconds:
    let seconds = ms / 1000;
    // 2- Extract hours:
    const hours = parseInt(seconds / 3600); // 3,600 seconds in 1 hour
    seconds = seconds % 3600; // seconds remaining after extracting hours
    // 3- Extract minutes:
    const minutes = parseInt(seconds / 60); // 60 seconds in 1 minute
    // 4- Keep only seconds not extracted to minutes:
    seconds = seconds % 60;

    const humanized = [
      pad(2, hours.toString(), "0"),
      pad(2, minutes.toString(), "0"),
    ].join(":");

    return humanized;
  };

  const now = new Date();
  // Русское название месяца в бизнес-таймзоне (browser-default locale давал
  // "July" у пользователей с английской системой).
  const month = formatMonth(now);
  const isToday = (date) => {
    const today = new Date();
    return (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    );
  };

  let ticketsLists = [];

  if (globalStats) {
    ticketsLists = [
      {
        title: "Активные",
        items: tickets.filter((ticket) => !ticket.isClosed),
      },
      {
        title: "Созданы",
        items: tickets.filter((ticket) => isToday(new Date(ticket.createdAt))),
      },
      {
        title: "Закрыты",
        items: tickets.filter((ticket) => isToday(new Date(ticket.finishedAt))),
      },
    ];
  }

  let myTicketsLists = [
    { title: "Активные", items: [] },
    { title: "Созданы", items: [] },
    { title: "Закрыты", items: [] },
  ];

  if (personalStats) {
    myTicketsLists = [
      {
        title: "Активные",
        items: tickets.filter(
          (ticket) =>
            ticket.responsibles
              .map((resp) => resp._id.toString())
              .includes(userId.toString()) && !ticket.isClosed,
        ),
      },
      {
        title: "Созданы",
        items: tickets
          .filter((ticket) => isToday(new Date(ticket.createdAt)))
          .filter((ticket) =>
            ticket.responsibles
              .map((resp) => resp._id.toString())
              .includes(userId.toString()),
          ),
      },
      {
        title: "Закрыты",
        items: tickets
          .filter((ticket) => isToday(new Date(ticket.finishedAt)))
          .filter((ticket) =>
            ticket.responsibles
              .map((resp) => resp._id.toString())
              .includes(userId.toString()),
          ),
      },
    ];
  }

  return (
    <>
      <Transitions>
        <Actions
          globalActions={globalActions}
          personalActions={personalActions}
          tickets={tickets}
          responsibles={responsibles}
        />
        <TicketsPanel
          ticketsLists={ticketsLists}
          myTicketsLists={myTicketsLists}
        />
        <DashboardCalendar scheduledWorks={scheduledWorks} tickets={tickets} />
        {(globalTasks || personalTasks) && (
          <Row className="mb-3 pb-3 border-bottom">
            <h1 className="display-5">
              <FaTasks /> Задачи
            </h1>
            {summary.tasks.map((task) => (
              <TaskCard key={task.desc} task={task} />
            ))}
          </Row>
        )}
        {modules.timeTracking.isActive && personalStats && (
          <>
            <Row
              className={"pb-3 " + (globalStats ? "mb-3 border-bottom" : "")}
            >
              <h1 className="display-5">
                <IoIosStats /> Моя статистика{" "}
                <small className="text-body-secondary">{month}</small>
              </h1>
              <Col className="my-3">
                <WorksCard
                  works={{
                    title: "Выполненные работы",
                    list: summary.myWorks?.list,
                    totalTime: msToHMS(summary.myWorks?.totalTime),
                  }}
                />
              </Col>
            </Row>
          </>
        )}
        {modules.timeTracking.isActive && globalStats && (
          <>
            <Row className="mb-3 pb-3">
              <h1 className="display-5">
                <IoIosStats /> Работы{" "}
                <small className="text-body-secondary">{month}</small>
              </h1>
              <Col className="my-3">
                <Tabs
                  variant="pills"
                  defaultActiveKey="clientsWorks"
                  className="mb-3"
                  justify
                >
                  <Tab
                    eventKey="clientsWorks"
                    title="Клиенты"
                    className="vh-100 px-4 overflow-auto"
                  >
                    {summary.clientsWorksReport.map((item) => {
                      return (
                        <div key={item.company}>
                          <label>{item.company}</label>
                          <ProgressBar
                            now={(item.totalTime / clientsMaxTotalTime) * 100}
                            label={msToHMS(item.totalTime)}
                            variant="info"
                            className="mb-3"
                          />
                        </div>
                      );
                    })}
                  </Tab>
                  <Tab
                    eventKey="specWorks"
                    title="Специалисты"
                    className="px-4 overflow-auto"
                  >
                    {summary.specsWorksReport.map((item) => {
                      return (
                        <div key={item.specialist}>
                          <label>{item.specialist}</label>
                          <ProgressBar
                            now={(item.totalTime / specsMaxTotalTime) * 100}
                            label={msToHMS(item.totalTime)}
                            variant="info"
                            className="mb-3"
                          />
                        </div>
                      );
                    })}
                  </Tab>
                </Tabs>
              </Col>
            </Row>
          </>
        )}
      </Transitions>
    </>
  );
};

export default Dashboard;

export async function loader() {
  const { token } = getLocalStorageData();

  if (!token) {
    return redirect("/auth");
  }

  if (token) {
    document.title = "DASHBOARD";

    const summaryResponse = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/dashboard/total`,
      {
        headers: {
          Authorization: "Bearer " + token,
        },
      },
    );

    if ([403].includes(summaryResponse.status)) {
      return redirect("/tickets");
    }

    if (!summaryResponse.ok) {
      throw summaryResponse;
    }

    const scheduledWorksResponse = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/all-scheduled-works`,
      {
        headers: {
          Authorization: "Bearer " + token,
        },
      },
    );

    if (!scheduledWorksResponse.ok) {
      throw scheduledWorksResponse;
    }

    const ticketsResponse = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/tickets/all-opened`,
      {
        headers: {
          Authorization: "Bearer " + token,
        },
      },
    );

    if (!ticketsResponse.ok) {
      throw ticketsResponse;
    }

    const ticketsList = await ticketsResponse.json();

    const responsiblesResponse = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/users/can-perform-tickets`,
      {
        headers: {
          Authorization: "Bearer " + token,
        },
      },
    );

    if (!responsiblesResponse.ok) {
      throw responsiblesResponse;
    }

    return {
      summary: await summaryResponse.json(),
      tickets: ticketsList.tickets,
      scheduledWorks: await scheduledWorksResponse.json(),
      responsibles: await responsiblesResponse.json(),
    };
  }

  return null;
}
