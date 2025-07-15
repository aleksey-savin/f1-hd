import { RouterProvider, createBrowserRouter } from "react-router";

// Root
import RootLayout from "./layout/Root.jsx";

// Dashboard
import Dashboard, { loader as dashboardLoader } from "./pages/Dashboard.jsx";

// Tickets
import Tickets, {
  loader as ticketsLoader,
  // action as ticketsAction,
} from "./pages/Ticket/List.jsx";

import ViewTicket, {
  loader as viewTicketLoader,
  action as viewTicketAction,
} from "./pages/Ticket/View.jsx";

import { action as deleteTicketAction } from "./pages/Ticket/Delete.jsx";

import AddTicketPage, {
  loader as addTicketLoader,
  action as addTicketAction,
} from "./pages/Ticket/Add.jsx";

import AddWorkPage, {
  loader as addWorkLoader,
  action as addWorkAction,
} from "./pages/Work/Add.jsx";

import ScheduleWorkPage, {
  loader as scheduleWorkLoader,
  action as scheduleWorkAction,
} from "./pages/Work/Schedule.jsx";

import ConfirmScheduledWorkPage, {
  loader as confirmScheduledWorkLoader,
} from "./pages/Work/ConfirmScheduled.jsx";

import UpdateWorkPage, {
  action as updateWorkAction,
  loader as updateWorkLoader,
} from "./pages/Work/Update.jsx";

import UpdateScheduledWorkPage, {
  loader as updateScheduledWorkLoader,
} from "./pages/Work/UpdateScheduled.jsx";

import UpdateTicketPage, {
  loader as updateTicketLoader,
  action as updateTicketAction,
} from "./pages/Ticket/Update.jsx";

import TicketsArchive, {
  loader as ticketsArchiveLoader,
  action as ticketsArchiveAction,
} from "./pages/Ticket/Archive.jsx";

// Companies
import Companies, { loader as companiesLoader } from "./pages/Company/List.jsx";

import AddCompanyPage, {
  loader as addCompanyLoader,
  action as addCompanyAction,
} from "./pages/Company/Add.jsx";

import UpdateCompanyPage, {
  loader as updateCompanyLoader,
  action as updateCompanyrAction,
} from "./pages/Company/Update.jsx";

import ViewCompanyPage, {
  loader as viewCompanyLoader,
  action as viewCompanyAction,
} from "./pages/Company/View.jsx";

// Ticket categories
import TicketCatogries, {
  loader as ticketCategoriesLoader,
  action as deleteTicketCategoryAction,
} from "./pages/TicketCategory/List.jsx";

import AddTicketCategoryPage, {
  loader as addTicketCategoryLoader,
  action as addTicketCategoryAction,
} from "./pages/TicketCategory/Add.jsx";

import UpdateTicketCategoryPage, {
  action as updateTicketCategoryAction,
  loader as updateTicketCategoryLoader,
} from "./pages/TicketCategory/Update.jsx";

// Ticket templates
import TicketTemplates, {
  loader as ticketTemplatesLoader,
  action as deleteTicketTemplateAction,
} from "./pages/TicketTemplate/List.jsx";

import AddTicketTemplatePage, {
  loader as addTicketTemplateLoader,
  action as addTicketTemplateAction,
} from "./pages/TicketTemplate/Add.jsx";

import UpdateTicketTemplatePage, {
  action as updateTicketTemplateAction,
  loader as updateTicketTemplateLoader,
} from "./pages/TicketTemplate/Update.jsx";

// Routine tasks
import RoutineTask, {
  loader as routineTaskLoader,
  action as deleteRoutineTaskAction,
} from "./pages/RoutineTask/List.jsx";

import AddRoutineTaskPage, {
  loader as addRoutineTaskLoader,
  action as addRoutineTaskAction,
} from "./pages/RoutineTask/Add.jsx";

import UpdateRoutineTaskPage, {
  action as updateRoutineTaskAction,
  loader as updateRoutineTaskLoader,
} from "./pages/RoutineTask/Update.jsx";

// ServicePlans
import ServicePlans, {
  loader as servicePlansLoader,
  action as servicePlansAction,
} from "./pages/ServicePlan/List.jsx";

import AddServicePlanPage, {
  loader as addServicePlanLoader,
  action as addServicePlanAction,
} from "./pages/ServicePlan/Add.jsx";

import UpdateServicePlanPage, {
  loader as updateServicePlanLoader,
  action as updateServicePlanAction,
} from "./pages/ServicePlan/Update.jsx";

import ViewServicePlanPage, {
  loader as viewServicePlanLoader,
  action as viewServicePlanAction,
} from "./pages/ServicePlan/View.jsx";

// ClientDevices
import ClientDevices, {
  loader as clientDevicesLoader,
  action as clientDevicesAction,
} from "./pages/ClientDevice/List.jsx";

import AddClientDevicePage, {
  loader as addClientDeviceLoader,
  action as addClientDeviceAction,
} from "./pages/ClientDevice/Add.jsx";

import UpdateClientDevicePage, {
  loader as updateClientDeviceLoader,
  action as updateClientDeviceAction,
} from "./pages/ClientDevice/Update.jsx";

// Mikrotik devices
import MikrotikDevices, {
  loader as mikrotikDevicesLoader,
} from "./pages/Mikrotik/List.jsx";

import AddMikrotikDevicePage, {
  action as AddMikrotikDeviceAction,
} from "./pages/Mikrotik/Add.jsx";

import UpdateMikrotikDevicePage, {
  action as UpdateMikrotikDeviceInfoAction,
  loader as UpdateMikrotikDeviceInfoLoader,
} from "./pages/Mikrotik/Update.jsx";

// Users
import Users, { loader as usersLoader } from "./pages/User/List.jsx";

import AddUserPage, {
  loader as addUserLoader,
  action as addUserAction,
} from "./pages/User/Add.jsx";

import UpdateUserPage, {
  loader as updateUserLoader,
  action as updateUserAction,
} from "./pages/User/Update.jsx";

import MyAccount, {
  loader as myAccountLoader,
  action as myAccountAction,
} from "./pages/User/MyAccount.jsx";

import ViewUserPage, {
  loader as viewUserLoader,
  action as viewUserAction,
} from "./pages/User/View.jsx";

// Preferences
import Preferences, {
  loader as prefsLoader,
  action as prefsAction,
} from "./pages/Preferences.jsx";

// Reports
import WorkReport, {
  loader as workReportLoader,
} from "./pages/Report/WorkReport.jsx";

import CompaniesNetworksReport, {
  loader as companiesNetworksLoader,
} from "./pages/Report/CompaniesNetworksReport.jsx";

// Finances
import SummaryReport, {
  loader as summaryReportLoader,
  action as summaryReportAction,
} from "./pages/Finances/SummaryReport.jsx";

import PersonalFinanceReport, {
  loader as personalFinanceReportLoader,
  action as personalFinanceReportAction,
} from "./pages/Finances/PersonalReport.jsx";

import EmployeeReport, {
  loader as employeeReportLoader,
} from "./pages/Finances/EmployeeReport.jsx";

// Auth
import Authentication, {
  loader as authLoader,
  action as authAction,
} from "./pages/Authentication.jsx";
import { authDataLoader, checkAuthLoader } from "./util/auth.js";
import { action as logoutAction } from "./components/Auth/Logout.jsx";
import ResetPassword, {
  loader as resetPasswordLoader,
  action as resetPasswordAction,
} from "./pages/ResetPassword.jsx";

// Errors
import Error from "./pages/Error.jsx";

function App() {
  const router = createBrowserRouter([
    // Auth
    {
      path: "auth",
      element: <Authentication />,
      loader: authLoader,
      action: authAction,
    },
    {
      path: "reset-password/:token",
      element: <ResetPassword />,
      loader: resetPasswordLoader,
      action: resetPasswordAction,
    },
    {
      path: "/",
      element: <RootLayout />,
      errorElement: <Error />,
      id: "root",
      loader: authDataLoader,
      children: [
        // Index
        {
          index: true,
          element: <Dashboard />,
          loader: dashboardLoader,
        },

        {
          path: "logout",
          loader: checkAuthLoader,
          action: logoutAction,
        },
        // Dashboard
        {
          path: "dashboard",
          element: <Dashboard />,
          loader: dashboardLoader,
        },
        // Tickets
        {
          path: "tickets",
          element: <Tickets />,
          loader: ticketsLoader,
          action: viewTicketAction,
          children: [
            {
              path: "add",
              loader: addTicketLoader,
              action: addTicketAction,
              element: <AddTicketPage />,
            },
            {
              path: "delete",
              action: deleteTicketAction,
            },
          ],
        },
        {
          path: "/tickets/:ticketNum",
          loader: viewTicketLoader,
          action: viewTicketAction,
          element: <ViewTicket />,
          children: [
            {
              path: "update",
              element: <UpdateTicketPage />,
              loader: updateTicketLoader,
              action: updateTicketAction,
            },
            {
              path: "work/add",
              loader: addWorkLoader,
              action: addWorkAction,
              element: <AddWorkPage />,
            },
            {
              path: "work/:workId/update",
              loader: updateWorkLoader,
              action: updateWorkAction,
              element: <UpdateWorkPage />,
            },
            {
              path: "work/schedule",
              action: scheduleWorkAction,
              loader: scheduleWorkLoader,
              element: <ScheduleWorkPage />,
            },
            {
              path: "work-scheduled/:workId/update",
              loader: updateScheduledWorkLoader,
              action: updateWorkAction,
              element: <UpdateScheduledWorkPage />,
            },
            {
              path: "work/:workId/confirm",
              action: updateWorkAction,
              loader: confirmScheduledWorkLoader,
              element: <ConfirmScheduledWorkPage />,
            },
          ],
        },
        {
          path: "closed-tickets",
          element: <TicketsArchive />,
          loader: ticketsArchiveLoader,
          action: ticketsArchiveAction,
        },
        // Works
        {
          path: "works",
          children: [
            {
              path: "add",
              element: <AddWorkPage />,
              action: addWorkAction,
            },
            {
              path: "schedule",
              element: <ScheduleWorkPage />,
              action: scheduleWorkAction,
            },
            {
              path: ":workId/update",
              element: <UpdateWorkPage />,
              action: updateWorkAction,
            },
          ],
        },
        // Companies
        {
          path: "companies",
          element: <Companies />,
          loader: companiesLoader,
          action: viewCompanyAction,
          children: [
            {
              path: "add",
              loader: addCompanyLoader,
              action: addCompanyAction,
              element: <AddCompanyPage />,
            },
            {
              path: "update/:id",
              loader: updateCompanyLoader,
              action: updateCompanyrAction,
              element: <UpdateCompanyPage />,
            },
          ],
        },
        {
          path: "companies/:id",
          loader: viewCompanyLoader,
          action: viewCompanyAction,
          element: <ViewCompanyPage />,
          children: [
            {
              path: "update",
              loader: updateCompanyLoader,
              action: updateCompanyrAction,
              element: <UpdateCompanyPage />,
            },
          ],
        },
        // Users
        {
          path: "users",
          element: <Users />,
          loader: usersLoader,
          action: viewUserAction,
          children: [
            {
              path: "add",
              loader: addUserLoader,
              action: addUserAction,
              element: <AddUserPage />,
            },
            {
              path: "update/:id",
              loader: updateUserLoader,
              action: updateUserAction,
              element: <UpdateUserPage />,
            },
          ],
        },
        {
          path: "users/:id",
          loader: viewUserLoader,
          action: viewUserAction,
          element: <ViewUserPage />,
          children: [
            {
              path: "update",
              loader: updateUserLoader,
              action: updateUserAction,
              element: <UpdateUserPage />,
            },
          ],
        },
        {
          path: "my-account",
          element: <MyAccount />,
          loader: myAccountLoader,
          action: myAccountAction,
        },
        // Ticket Categories
        {
          path: "ticket-categories",
          element: <TicketCatogries />,
          loader: ticketCategoriesLoader,
          action: deleteTicketCategoryAction,
          children: [
            {
              path: "add",
              loader: addTicketCategoryLoader,
              action: addTicketCategoryAction,
              element: <AddTicketCategoryPage />,
            },
            {
              path: "update/:id",
              loader: updateTicketCategoryLoader,
              action: updateTicketCategoryAction,
              element: <UpdateTicketCategoryPage />,
            },
            {
              path: "delete/:id",
            },
          ],
        },
        // Ticket Templates
        {
          path: "ticket-templates",
          element: <TicketTemplates />,
          loader: ticketTemplatesLoader,
          action: deleteTicketTemplateAction,
          children: [
            {
              path: "add",
              loader: addTicketTemplateLoader,
              action: addTicketTemplateAction,
              element: <AddTicketTemplatePage />,
            },
            {
              path: "update/:id",
              loader: updateTicketTemplateLoader,
              action: updateTicketTemplateAction,
              element: <UpdateTicketTemplatePage />,
            },
            {
              path: "delete/:id",
            },
          ],
        },
        // Routine tasks
        {
          path: "routine-tasks",
          element: <RoutineTask />,
          loader: routineTaskLoader,
          action: deleteRoutineTaskAction,
          children: [
            {
              path: "add",
              loader: addRoutineTaskLoader,
              action: addRoutineTaskAction,
              element: <AddRoutineTaskPage />,
            },
            {
              path: "update/:id",
              loader: updateRoutineTaskLoader,
              action: updateRoutineTaskAction,
              element: <UpdateRoutineTaskPage />,
            },
            {
              path: "delete/:id",
            },
          ],
        },
        // Service Plans
        {
          path: "finances/service-plans",
          element: <ServicePlans />,
          loader: servicePlansLoader,
          action: servicePlansAction,
          children: [
            {
              path: "add",
              loader: addServicePlanLoader,
              action: addServicePlanAction,
              element: <AddServicePlanPage />,
            },
            {
              path: "update/:id",
              loader: updateServicePlanLoader,
              action: updateServicePlanAction,
              element: <UpdateServicePlanPage />,
            },
          ],
        },
        // Client Devices
        {
          path: "inventory/client-devices",
          element: <ClientDevices />,
          loader: clientDevicesLoader,
          action: clientDevicesAction,
          children: [
            {
              path: "add",
              loader: addClientDeviceLoader,
              action: addClientDeviceAction,
              element: <AddClientDevicePage />,
            },
            {
              path: "update/:id",
              loader: updateClientDeviceLoader,
              action: updateClientDeviceAction,
              element: <UpdateClientDevicePage />,
            },
            {
              path: "delete/:id",
            },
          ],
        },
        {
          path: "finances/service-plans/:id",
          loader: viewServicePlanLoader,
          action: viewServicePlanAction,
          element: <ViewServicePlanPage />,
          children: [
            {
              path: "update",
              loader: updateServicePlanLoader,
              action: updateServicePlanAction,
              element: <UpdateServicePlanPage />,
            },
            {
              path: "delete",
            },
          ],
        },
        // Devices
        {
          path: "devices/mikrotik",
          element: <MikrotikDevices />,
          loader: mikrotikDevicesLoader,
          children: [
            {
              path: "add",
              action: AddMikrotikDeviceAction,
              element: <AddMikrotikDevicePage />,
            },
            {
              path: "update-info/:id",
              loader: UpdateMikrotikDeviceInfoLoader,
              action: UpdateMikrotikDeviceInfoAction,
              element: <UpdateMikrotikDevicePage />,
            },
          ],
        },
        // Reports
        {
          path: "report/work",
          element: <WorkReport />,
          loader: workReportLoader,
        },
        {
          path: "report/networks",
          element: <CompaniesNetworksReport />,
          loader: companiesNetworksLoader,
        },
        // Finances
        {
          path: "finances/summary-report",
          element: <SummaryReport />,
          loader: summaryReportLoader,
          action: summaryReportAction,
        },
        {
          path: "finances/personal-report",
          element: <PersonalFinanceReport />,
          loader: personalFinanceReportLoader,
          action: personalFinanceReportAction,
        },
        {
          path: "finances/employee-report",
          element: <EmployeeReport />,
          loader: employeeReportLoader,
        },
        // Preferences
        {
          path: "preferences",
          element: <Preferences />,
          loader: prefsLoader,
          action: prefsAction,
        },
      ],
    },
  ]);
  return <RouterProvider router={router} />;
}

export default App;
