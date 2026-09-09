import { RouterProvider, createBrowserRouter, redirect } from "react-router";

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

// Форма заявки — фабрика маршрутов: форма одна, хозяев несколько (список,
// главная, карточка шаблона). Ширину шторки маршрут формы несёт в handle.
import { ticketFormRoutes } from "./routes/ticket-forms.jsx";
import { SHEET_LG, SHEET_MD, SHEET_XL } from "@/components/app/FormOutlet";

import ChecklistTemplateListPage from "./pages/ChecklistTemplate/List.jsx";
import AddChecklistTemplatePage from "./pages/ChecklistTemplate/Add.jsx";
import UpdateChecklistTemplatePage from "./pages/ChecklistTemplate/Update.jsx";
import {
  checklistTemplateFormLoader,
  addChecklistTemplateAction,
  updateChecklistTemplateAction,
  deleteChecklistTemplateAction,
} from "./pages/ChecklistTemplate/routes.js";

import WorkFormRoute from "./components/Work/WorkFormRoute.jsx";
import {
  workFormLoader,
  addWorkAction,
  scheduleWorkAction,
  updateWorkAction,
} from "./pages/Work/work-routes.js";

import UpdateTicketPage, {
  loader as updateTicketLoader,
  makeLoader as makeTicketFormLoader,
} from "./pages/Ticket/Update.jsx";

import ArchivePage, { loader as archiveLoader } from "./pages/Archive.jsx";

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

import AddCompanyServicePlanPage, {
  loader as addCompanyServicePlanLoader,
  action as addCompanyServicePlanAction,
} from "./pages/Company/AddServicePlan.jsx";
import ViewCompanyPage, {
  loader as viewCompanyLoader,
  action as viewCompanyAction,
} from "./pages/Company/View.jsx";

// Роли — справочник, отдельная страница в «Администрировании»
import RolesPage, {
  loader as rolesLoader,
  action as deleteRoleAction,
} from "./pages/Role/List.jsx";
import AddRolePage, {
  loader as addRoleLoader,
  action as addRoleAction,
} from "./pages/Role/Add.jsx";
import UpdateRolePage, {
  loader as updateRoleLoader,
  action as updateRoleAction,
} from "./pages/Role/Update.jsx";

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

// Knowledge Base
import KnowledgeBaseList, {
  loader as knowledgeBaseListLoader,
} from "./pages/KnowledgeBase/List.jsx";

import AddKnowledgeNotePage, {
  loader as addKnowledgeNoteLoader,
} from "./pages/KnowledgeBase/Add.jsx";

import ViewKnowledgeNotePage, {
  loader as viewKnowledgeNoteLoader,
} from "./pages/KnowledgeBase/View.jsx";

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

import ViewTicketTemplatePage, {
  loader as viewTicketTemplateLoader,
  action as viewTicketTemplateAction,
} from "./pages/TicketTemplate/View.jsx";

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

import ViewRoutineTaskPage, {
  loader as viewRoutineTaskLoader,
  action as viewRoutineTaskAction,
} from "./pages/RoutineTask/View.jsx";

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

import ViewClientDevicePage, {
  loader as viewClientDeviceLoader,
  action as viewClientDeviceAction,
} from "./pages/ClientDevice/View.jsx";

// Location Management
import LocationList, {
  loader as locationLoader,
  action as locationAction,
} from "./pages/Location/List.jsx";

import AddLocationPage, {
  loader as addLocationLoader,
  action as addLocationAction,
} from "./pages/Location/Add.jsx";
import UpdateLocationPage, {
  loader as updateLocationLoader,
  action as updateLocationAction,
} from "./pages/Location/Update.jsx";
import ViewLocationPage, {
  loader as viewLocationLoader,
  action as viewLocationAction,
} from "./pages/Location/View.jsx";

// Device Types
import DeviceTypeListPage, {
  action as deviceTypeAction,
} from "./pages/DeviceType/List.jsx";
import AddDeviceTypePage, {
  loader as addDeviceTypeLoader,
  action as addDeviceTypeAction,
} from "./pages/DeviceType/Add.jsx";
import UpdateDeviceTypePage, {
  loader as updateDeviceTypeLoader,
  action as updateDeviceTypeAction,
} from "./pages/DeviceType/Update.jsx";
import ViewDeviceTypePage, {
  loader as viewDeviceTypeLoader,
  action as viewDeviceTypeAction,
} from "./pages/DeviceType/View.jsx";
import AttributeAddPage, {
  loader as attributeAddLoader,
  action as attributeAddAction,
} from "./pages/DeviceType/AttributeAdd.jsx";
import AttributeUpdatePage, {
  loader as attributeUpdateLoader,
  action as attributeUpdateAction,
} from "./pages/DeviceType/AttributeUpdate.jsx";

// Vendors
import VendorListPage, {
  action as vendorAction,
} from "./pages/Vendor/List.jsx";
import AddVendorPage, {
  loader as addVendorLoader,
  action as addVendorAction,
} from "./pages/Vendor/Add.jsx";
import UpdateVendorPage, {
  loader as updateVendorLoader,
  action as updateVendorAction,
} from "./pages/Vendor/Update.jsx";
import ViewVendorPage, {
  loader as viewVendorLoader,
  action as viewVendorAction,
} from "./pages/Vendor/View.jsx";

// Suppliers
import SupplierListPage, {
  loader as supplierListLoader,
  action as supplierAction,
} from "./pages/Supplier/List.jsx";
import AddSupplierPage, {
  loader as addSupplierLoader,
  action as addSupplierAction,
} from "./pages/Supplier/Add.jsx";
import UpdateSupplierPage, {
  loader as updateSupplierLoader,
  action as updateSupplierAction,
} from "./pages/Supplier/Update.jsx";
import ViewSupplierPage, {
  loader as viewSupplierLoader,
  action as viewSupplierAction,
} from "./pages/Supplier/View.jsx";

// Device Attributes
import DeviceAttributeListPage, {
  action as deviceAttributeAction,
} from "./pages/DeviceAttribute/List.jsx";
import AddDeviceAttributePage, {
  loader as addDeviceAttributeLoader,
  action as addDeviceAttributeAction,
} from "./pages/DeviceAttribute/Add.jsx";
import UpdateDeviceAttributePage, {
  loader as updateDeviceAttributeLoader,
  action as updateDeviceAttributeAction,
} from "./pages/DeviceAttribute/Update.jsx";

// Device Models
import DeviceModelListPage, {
  action as deviceModelAction,
} from "./pages/DeviceModel/List.jsx";
import AddDeviceModelPage, {
  loader as addDeviceModelLoader,
  action as addDeviceModelAction,
} from "./pages/DeviceModel/Add.jsx";
import UpdateDeviceModelPage, {
  loader as updateDeviceModelLoader,
  action as updateDeviceModelAction,
} from "./pages/DeviceModel/Update.jsx";
import ViewDeviceModelPage, {
  loader as viewDeviceModelLoader,
  action as viewDeviceModelAction,
} from "./pages/DeviceModel/View.jsx";

// Device Configurations
import AddDeviceConfigurationPage, {
  loader as addDeviceConfigurationLoader,
  action as addDeviceConfigurationAction,
} from "./pages/DeviceConfiguration/Add.jsx";
import UpdateDeviceConfigurationPage, {
  loader as updateDeviceConfigurationLoader,
  action as updateDeviceConfigurationAction,
} from "./pages/DeviceConfiguration/Update.jsx";

// Mikrotik devices
import MikrotikDevices, {
  loader as mikrotikDevicesLoader,
} from "./pages/Mikrotik/List.jsx";
import MikrotikRecordPage, {
  loader as mikrotikRecordLoader,
} from "./pages/Mikrotik/Record.jsx";
import MikrotikDeviceForm from "./components/Mikrotik/DeviceForm.jsx";
import MikrotikScheduleForm, {
  action as mikrotikScheduleAction,
} from "./components/Mikrotik/ScheduleForm.jsx";

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

// Finances

// Auth
import AuthLayout, {
  loader as authLayoutLoader,
} from "./pages/Auth/Layout.tsx";
import Login, {
  loader as loginLoader,
  action as loginAction,
} from "./pages/Auth/Login.tsx";
import LoginCode, {
  loader as loginCodeLoader,
  action as loginCodeAction,
} from "./pages/Auth/Code.tsx";
import NewPassword, {
  loader as newPasswordLoader,
  action as newPasswordAction,
} from "./pages/Auth/NewPassword.tsx";
import { authDataLoader } from "./util/auth.js";
import { setUnauthorizedHandler } from "./lib/api";
import { action as logoutAction } from "./pages/Auth/logout.js";

// Errors
import Error from "./pages/Error.jsx";

// Единая реакция на 401 из api()-клиента. Жёсткая перезагрузка, а не
// router.navigate: сторы zustand живут вне маршрутизатора, и только полный
// сброс страницы гарантированно уносит их состояние вместе с мёртвым сеансом.
setUnauthorizedHandler(() => {
  if (window.location.pathname !== "/auth") {
    window.location.assign("/auth");
  }
});

function App() {
  const router = createBrowserRouter([
    // Пред-авторизационные экраны: одна оболочка на все, режимы — маршрутами.
    // Маршрут беспутевой, потому что /reset-password/:token уже разослан
    // письмами и не может стать потомком /auth. shouldRevalidate гасит
    // повторный запрос настроек после каждого неудачного входа.
    {
      id: "auth",
      element: <AuthLayout />,
      loader: authLayoutLoader,
      shouldRevalidate: () => false,
      errorElement: <Error />,
      children: [
        {
          path: "auth",
          element: <Login />,
          loader: loginLoader,
          action: loginAction,
        },
        {
          path: "auth/code",
          element: <LoginCode />,
          loader: loginCodeLoader,
          action: loginCodeAction,
        },
        {
          path: "reset-password/:token",
          element: <NewPassword />,
          loader: newPasswordLoader,
          action: newPasswordAction,
        },
      ],
    },
    {
      // Вход под пользователем по ссылке: своя страница вне оболочки, потому
      // что сеанса на момент открытия ещё нет — код обменивается на него здесь
      // же и вкладка уходит на главную.
      path: "impersonate",
      lazy: async () => {
        const module = await import("./pages/Impersonate.tsx");
        return { Component: module.default };
      },
    },
    {
      // Согласование отчёта по ссылке из письма: без входа в приложение и без
      // его оболочки — авторизацией служит сам токен в адресе
      path: "approval/:token",
      lazy: async () => {
        const publicModule = await import("./pages/Approval/Public.tsx");
        return {
          Component: publicModule.default,
          loader: publicModule.loader,
        };
      },
    },
    {
      path: "/",
      element: <RootLayout />,
      errorElement: <Error />,
      id: "root",
      loader: authDataLoader,
      children: [
        {
          // Ошибки загрузчиков детей ловим НИЖЕ корня: оболочка (навбар,
          // таб-бар, тема) остаётся живой, страница ошибки рендерится в
          // контентной области. errorElement на корне выше — фолбэк на
          // случай падения самого authDataLoader.
          errorElement: <Error />,
          children: [
            // Главная живёт на /dashboard: у неё есть вложенный маршрут формы
            // заявки, а индексному маршруту детей не положено
            {
              index: true,
              loader: () => redirect("/dashboard"),
            },

            {
              // Загрузчика нет намеренно: выход должен срабатывать и когда
              // сеанс уже мёртв — иначе человек застревает на странице,
              // с которой не может уйти.
              path: "logout",
              action: logoutAction,
            },
            // Dashboard
            {
              path: "dashboard",
              element: <Dashboard />,
              loader: dashboardLoader,
              // «Новая заявка» с главной: форма — вложенный маршрут главной,
              // за шторкой остаётся главная, а не список заявок
              children: ticketFormRoutes({ prefix: "tickets/", modes: ["add"] }),
            },
            // Tickets
            {
              path: "tickets",
              element: <Tickets />,
              loader: ticketsLoader,
              action: viewTicketAction,
              children: [
                // Создание и правка со списка живут ПОД списком, а не под
                // карточкой: маршрут решает, что видно за шторкой. Форма одна,
                // хозяев несколько — см. routes/ticket-forms.jsx
                ...ticketFormRoutes(),
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
                // action у формы свой: роутер шлёт сабмит в самый глубокий
                // маршрут адреса, и без него правка отвечала бы 405
                {
                  path: "update",
                  handle: SHEET_LG,
                  element: <UpdateTicketPage />,
                  loader: updateTicketLoader,
                  action: viewTicketAction,
                },
                // «Обработать» — та же форма с другой подписью сабмита: у неё шесть
                // полей, и диалогом она была нарушением «диалог → только мелкие вещи»
                {
                  path: "process",
                  handle: SHEET_LG,
                  element: <UpdateTicketPage mode="process" />,
                  loader: makeTicketFormLoader("process"),
                  action: viewTicketAction,
                },
                {
                  path: "work/add",
                  handle: SHEET_LG,
                  loader: workFormLoader,
                  action: addWorkAction,
                  element: <WorkFormRoute mode="add" />,
                },
                {
                  path: "work/:workId/update",
                  handle: SHEET_LG,
                  loader: workFormLoader,
                  action: updateWorkAction,
                  element: <WorkFormRoute mode="update" />,
                },
                {
                  path: "work/schedule",
                  handle: SHEET_LG,
                  loader: workFormLoader,
                  action: scheduleWorkAction,
                  element: <WorkFormRoute mode="schedule" />,
                },
                {
                  path: "work-scheduled/:workId/update",
                  handle: SHEET_LG,
                  loader: workFormLoader,
                  action: updateWorkAction,
                  element: <WorkFormRoute mode="updateScheduled" />,
                },
                {
                  path: "work/:workId/confirm",
                  handle: SHEET_LG,
                  loader: workFormLoader,
                  action: updateWorkAction,
                  element: <WorkFormRoute mode="confirm" />,
                },
              ],
            },
            {
              path: "archive",
              element: <ArchivePage />,
              loader: archiveLoader,
            },
            // Постоянный редирект со старого адреса архива (закладки и внешние
            // ссылки); query переносится (?view=works и будущие параметры)
            {
              path: "closed-tickets",
              loader: ({ request }) =>
                redirect(`/archive${new URL(request.url).search}`),
            },
            // Knowledge Base
            {
              path: "knowledge-base",
              handle: { can: { knowledge: ["read"] } },
              element: <KnowledgeBaseList />,
              loader: knowledgeBaseListLoader,
              children: [
                {
                  path: "add",
                  element: <AddKnowledgeNotePage />,
                  loader: addKnowledgeNoteLoader,
                },
                {
                  path: ":id",
                  element: <ViewKnowledgeNotePage />,
                  loader: viewKnowledgeNoteLoader,
                },
              ],
            },
            // Companies
            {
              path: "companies",
              handle: { can: { company: ["read"] } },
              element: <Companies />,
              loader: companiesLoader,
              action: viewCompanyAction,
              children: [
                {
                  path: "add",
                  handle: { can: { company: ["manage"] }, ...SHEET_LG },
                  loader: addCompanyLoader,
                  action: addCompanyAction,
                  element: <AddCompanyPage />,
                },
                {
                  path: "update/:id",
                  handle: { can: { company: ["manage"] }, ...SHEET_XL },
                  loader: updateCompanyLoader,
                  action: updateCompanyrAction,
                  element: <UpdateCompanyPage />,
                },
              ],
            },
            {
              path: "companies/:id",
              id: "company-view",
              loader: viewCompanyLoader,
              action: viewCompanyAction,
              element: <ViewCompanyPage />,
              children: [
                {
                  path: "update",
                  handle: SHEET_XL,
                  loader: updateCompanyLoader,
                  action: updateCompanyrAction,
                  element: <UpdateCompanyPage />,
                },
                {
                  // «Новая услуга» из диалога «Добавить услугу»: мастер услуги в
                  // wide-шторке карточки, создание + подключение одним запросом
                  path: "service-plans/add",
                  handle: SHEET_LG,
                  loader: addCompanyServicePlanLoader,
                  action: addCompanyServicePlanAction,
                  element: <AddCompanyServicePlanPage />,
                },
              ],
            },
            // Users
            {
              path: "users",
              handle: { can: { user: ["read"] } },
              element: <Users />,
              loader: usersLoader,
              action: viewUserAction,
              children: [
                {
                  path: "add",
                  handle: { can: { user: ["manage"] }, ...SHEET_LG },
                  loader: addUserLoader,
                  action: addUserAction,
                  element: <AddUserPage />,
                },
                {
                  path: "update/:id",
                  handle: { can: { user: ["manage"] }, ...SHEET_XL },
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
                  handle: SHEET_XL,
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
            // Роли
            {
              path: "roles",
              handle: { can: { role: ["read"] } },
              element: <RolesPage />,
              loader: rolesLoader,
              action: deleteRoleAction,
              children: [
                {
                  // Матрица прав длинная: у формы рейл по группам, значит xl
                  path: "add",
                  handle: { can: { role: ["manage"] }, ...SHEET_XL },
                  element: <AddRolePage />,
                  loader: addRoleLoader,
                  action: addRoleAction,
                },
                {
                  path: "update/:key",
                  handle: { can: { role: ["manage"] }, ...SHEET_XL },
                  element: <UpdateRolePage />,
                  loader: updateRoleLoader,
                  action: updateRoleAction,
                },
              ],
            },
            // Ticket Categories
            {
              path: "ticket-categories",
              handle: { can: { ticketCategory: ["manage"] } },
              element: <TicketCatogries />,
              loader: ticketCategoriesLoader,
              action: deleteTicketCategoryAction,
              children: [
                {
                  path: "add",
                  handle: SHEET_MD,
                  loader: addTicketCategoryLoader,
                  action: addTicketCategoryAction,
                  element: <AddTicketCategoryPage />,
                },
                {
                  path: "update/:id",
                  handle: SHEET_MD,
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
              handle: { can: { ticketTemplate: ["manage"] } },
              element: <TicketTemplates />,
              loader: ticketTemplatesLoader,
              action: deleteTicketTemplateAction,
              children: [
                {
                  path: "add",
                  handle: SHEET_LG,
                  loader: addTicketTemplateLoader,
                  action: addTicketTemplateAction,
                  element: <AddTicketTemplatePage />,
                },
                {
                  path: "update/:id",
                  handle: SHEET_XL,
                  loader: updateTicketTemplateLoader,
                  action: updateTicketTemplateAction,
                  element: <UpdateTicketTemplatePage />,
                },
                {
                  path: "delete/:id",
                },
              ],
            },
            {
              path: "ticket-templates/:id",
              loader: viewTicketTemplateLoader,
              action: viewTicketTemplateAction,
              element: <ViewTicketTemplatePage />,
              children: [
                // «Создать заявку» с карточки шаблона — шторка здесь же, за ней
                // остаётся карточка; ?template= подставляет заготовку
                ...ticketFormRoutes({ prefix: "tickets/", modes: ["add"] }),
                {
                  path: "update",
                  handle: SHEET_XL,
                  loader: updateTicketTemplateLoader,
                  action: updateTicketTemplateAction,
                  element: <UpdateTicketTemplatePage />,
                },
                {
                  path: "delete",
                },
              ],
            },
            // Шаблоны чек-листов
            {
              path: "tickets/checklist-templates",
              handle: { can: { checklistTemplate: ["manage"] } },
              element: <ChecklistTemplateListPage />,
              action: deleteChecklistTemplateAction,
              children: [
                {
                  path: "add",
                  handle: SHEET_MD,
                  loader: checklistTemplateFormLoader,
                  action: addChecklistTemplateAction,
                  element: <AddChecklistTemplatePage />,
                },
                {
                  path: "update/:id",
                  handle: SHEET_MD,
                  loader: checklistTemplateFormLoader,
                  action: updateChecklistTemplateAction,
                  element: <UpdateChecklistTemplatePage />,
                },
              ],
            },
            // Routine tasks
            {
              path: "routine-tasks",
              handle: { can: { routineTask: ["manage"] } },
              element: <RoutineTask />,
              loader: routineTaskLoader,
              action: deleteRoutineTaskAction,
              children: [
                {
                  path: "add",
                  handle: SHEET_LG,
                  loader: addRoutineTaskLoader,
                  action: addRoutineTaskAction,
                  element: <AddRoutineTaskPage />,
                },
                {
                  path: "update/:id",
                  handle: SHEET_XL,
                  loader: updateRoutineTaskLoader,
                  action: updateRoutineTaskAction,
                  element: <UpdateRoutineTaskPage />,
                },
                {
                  path: "delete/:id",
                },
              ],
            },
            {
              path: "routine-tasks/:id",
              loader: viewRoutineTaskLoader,
              action: viewRoutineTaskAction,
              element: <ViewRoutineTaskPage />,
              children: [
                {
                  path: "update",
                  handle: SHEET_XL,
                  loader: updateRoutineTaskLoader,
                  action: updateRoutineTaskAction,
                  element: <UpdateRoutineTaskPage />,
                },
                {
                  path: "delete",
                },
              ],
            },
            // Service Plans
            {
              path: "finances/service-plans",
              handle: { can: { servicePlan: ["read"] } },
              element: <ServicePlans />,
              loader: servicePlansLoader,
              action: servicePlansAction,
              children: [
                {
                  path: "add",
                  handle: SHEET_LG,
                  loader: addServicePlanLoader,
                  action: addServicePlanAction,
                  element: <AddServicePlanPage />,
                },
                {
                  path: "update/:id",
                  handle: SHEET_XL,
                  loader: updateServicePlanLoader,
                  action: updateServicePlanAction,
                  element: <UpdateServicePlanPage />,
                },
              ],
            },
            // Client Devices
            {
              path: "inventory/client-devices",
              handle: { can: { device: ["read"] } },
              element: <ClientDevices />,
              loader: clientDevicesLoader,
              action: clientDevicesAction,
              children: [
                {
                  path: "add",
                  handle: SHEET_LG,
                  loader: addClientDeviceLoader,
                  action: addClientDeviceAction,
                  element: <AddClientDevicePage />,
                },
                {
                  path: "update/:id",
                  handle: SHEET_XL,
                  loader: updateClientDeviceLoader,
                  action: updateClientDeviceAction,
                  element: <UpdateClientDevicePage />,
                },
                {
                  path: "delete/:id",
                },
              ],
            },
            // Карточка устройства (полная страница) + редактирование в offcanvas
            {
              path: "inventory/client-devices/:id",
              element: <ViewClientDevicePage />,
              loader: viewClientDeviceLoader,
              action: viewClientDeviceAction,
              children: [
                {
                  path: "update",
                  handle: SHEET_XL,
                  loader: updateClientDeviceLoader,
                  action: updateClientDeviceAction,
                  element: <UpdateClientDevicePage />,
                },
              ],
            },

            // Location Management
            {
              path: "inventory/locations",
              handle: { can: { device: ["read"] } },
              element: <LocationList />,
              loader: locationLoader,
              action: locationAction,
              children: [
                {
                  path: "add",
                  handle: SHEET_MD,
                  loader: addLocationLoader,
                  action: addLocationAction,
                  element: <AddLocationPage />,
                },
                {
                  path: "update/:id",
                  handle: SHEET_MD,
                  loader: updateLocationLoader,
                  action: updateLocationAction,
                  element: <UpdateLocationPage />,
                },
              ],
            },
            {
              path: "inventory/locations/:id",
              element: <ViewLocationPage />,
              loader: viewLocationLoader,
              action: viewLocationAction,
              children: [
                // Правка расположения — в нижней шторке карточки: после сабмита
                // остаёмся на карточке
                {
                  path: "update",
                  handle: SHEET_MD,
                  loader: updateLocationLoader,
                  action: updateLocationAction,
                  element: <UpdateLocationPage />,
                },
                // Вложенное расположение — шторка здесь же; loader читает
                // query-пресеты ?company=&parent=; после сабмита форма уводит на
                // карточку созданного расположения
                {
                  path: "add",
                  handle: SHEET_MD,
                  loader: addLocationLoader,
                  action: addLocationAction,
                  element: <AddLocationPage />,
                },
              ],
            },

            // Device Types
            {
              path: "inventory/device-types",
              handle: { can: { inventoryCatalog: ["read"] } },
              element: <DeviceTypeListPage />,
              action: deviceTypeAction,
              children: [
                {
                  path: "add",
                  handle: SHEET_MD,
                  element: <AddDeviceTypePage />,
                  loader: addDeviceTypeLoader,
                  action: addDeviceTypeAction,
                },
                {
                  path: "update/:id",
                  handle: SHEET_MD,
                  element: <UpdateDeviceTypePage />,
                  loader: updateDeviceTypeLoader,
                  action: updateDeviceTypeAction,
                },
              ],
            },
            {
              path: "inventory/device-types/:id",
              element: <ViewDeviceTypePage />,
              loader: viewDeviceTypeLoader,
              action: viewDeviceTypeAction,
              children: [
                // Правка типа — в нижней шторке карточки: после сабмита остаёмся
                // на карточке (правило «редактирование не меняет страницу»)
                {
                  path: "update",
                  handle: SHEET_MD,
                  element: <UpdateDeviceTypePage />,
                  loader: updateDeviceTypeLoader,
                  action: updateDeviceTypeAction,
                },
                // Новая модель с карточки типа — шторка здесь же; после сабмита
                // форма сама уводит на карточку созданной модели
                {
                  path: "models/add",
                  handle: SHEET_MD,
                  element: <AddDeviceModelPage presetFrom="deviceType" />,
                  loader: addDeviceModelLoader,
                  action: addDeviceModelAction,
                },
                // Атрибуты типа — формы add/update в нижней шторке карточки
                {
                  path: "attributes/add",
                  handle: SHEET_MD,
                  element: <AttributeAddPage />,
                  loader: attributeAddLoader,
                  action: attributeAddAction,
                },
                {
                  path: "attributes/update/:attrId",
                  handle: SHEET_MD,
                  element: <AttributeUpdatePage />,
                  loader: attributeUpdateLoader,
                  action: attributeUpdateAction,
                },
              ],
            },

            // Vendors
            {
              path: "inventory/vendors",
              handle: { can: { inventoryCatalog: ["read"] } },
              element: <VendorListPage />,
              action: vendorAction,
              children: [
                {
                  path: "add",
                  handle: SHEET_MD,
                  element: <AddVendorPage />,
                  loader: addVendorLoader,
                  action: addVendorAction,
                },
                {
                  path: "update/:id",
                  handle: SHEET_MD,
                  element: <UpdateVendorPage />,
                  loader: updateVendorLoader,
                  action: updateVendorAction,
                },
              ],
            },
            {
              path: "inventory/suppliers",
              handle: { can: { supplier: ["read"] } },
              element: <SupplierListPage />,
              loader: supplierListLoader,
              action: supplierAction,
              children: [
                {
                  path: "add",
                  handle: SHEET_MD,
                  element: <AddSupplierPage />,
                  loader: addSupplierLoader,
                  action: addSupplierAction,
                },
                {
                  path: "update/:id",
                  handle: SHEET_MD,
                  element: <UpdateSupplierPage />,
                  loader: updateSupplierLoader,
                  action: updateSupplierAction,
                },
              ],
            },
            {
              path: "inventory/suppliers/:id",
              element: <ViewSupplierPage />,
              loader: viewSupplierLoader,
              action: viewSupplierAction,
              children: [
                // Правка — в шторке карточки: после сабмита остаёмся на ней
                {
                  path: "update",
                  handle: SHEET_MD,
                  element: <UpdateSupplierPage />,
                  loader: updateSupplierLoader,
                  action: updateSupplierAction,
                },
              ],
            },
            {
              path: "inventory/vendors/:id",
              element: <ViewVendorPage />,
              loader: viewVendorLoader,
              action: viewVendorAction,
              children: [
                // Правка вендора — в нижней шторке карточки: после сабмита
                // остаёмся на карточке (правило «редактирование не меняет
                // страницу»)
                {
                  path: "update",
                  handle: SHEET_MD,
                  element: <UpdateVendorPage />,
                  loader: updateVendorLoader,
                  action: updateVendorAction,
                },
                // Новая модель с карточки вендора — шторка здесь же; после
                // сабмита форма сама уводит на карточку созданной модели
                {
                  path: "models/add",
                  handle: SHEET_MD,
                  element: <AddDeviceModelPage presetFrom="vendor" />,
                  loader: addDeviceModelLoader,
                  action: addDeviceModelAction,
                },
              ],
            },

            // Device Attributes
            {
              path: "inventory/device-attributes",
              handle: { can: { inventoryCatalog: ["read"] } },
              element: <DeviceAttributeListPage />,
              action: deviceAttributeAction,
              children: [
                {
                  path: "add",
                  handle: SHEET_MD,
                  element: <AddDeviceAttributePage />,
                  loader: addDeviceAttributeLoader,
                  action: addDeviceAttributeAction,
                },
                {
                  path: "update/:id",
                  handle: SHEET_MD,
                  element: <UpdateDeviceAttributePage />,
                  loader: updateDeviceAttributeLoader,
                  action: updateDeviceAttributeAction,
                },
              ],
            },

            // Device Models
            {
              path: "inventory/device-models",
              handle: { can: { inventoryCatalog: ["read"] } },
              element: <DeviceModelListPage />,
              action: deviceModelAction,
              children: [
                {
                  path: "add",
                  handle: SHEET_MD,
                  element: <AddDeviceModelPage />,
                  loader: addDeviceModelLoader,
                  action: addDeviceModelAction,
                },
                {
                  path: "update/:id",
                  handle: SHEET_MD,
                  element: <UpdateDeviceModelPage />,
                  loader: updateDeviceModelLoader,
                  action: updateDeviceModelAction,
                },
              ],
            },
            {
              path: "inventory/device-models/:id",
              element: <ViewDeviceModelPage />,
              loader: viewDeviceModelLoader,
              action: viewDeviceModelAction,
              children: [
                // Правка модели — в нижней шторке карточки: после сабмита
                // остаёмся на карточке (статический "update" матчится раньше
                // "update/:configId" конфигураций)
                {
                  path: "update",
                  handle: SHEET_MD,
                  element: <UpdateDeviceModelPage />,
                  loader: updateDeviceModelLoader,
                  action: updateDeviceModelAction,
                },
                // Конфигурации модели открываются в нижнем Offcanvas страницы просмотра.
                {
                  path: "add",
                  handle: SHEET_MD,
                  element: <AddDeviceConfigurationPage />,
                  loader: addDeviceConfigurationLoader,
                  action: addDeviceConfigurationAction,
                },
                {
                  path: "update/:configId",
                  handle: SHEET_MD,
                  element: <UpdateDeviceConfigurationPage />,
                  loader: updateDeviceConfigurationLoader,
                  action: updateDeviceConfigurationAction,
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
                  handle: SHEET_XL,
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
              handle: { can: { mikrotik: ["read"] } },
              element: <MikrotikDevices />,
              loader: mikrotikDevicesLoader,
              // Формы создания/правки — нижняя шторка списка (Outlet ListWrapper).
              children: [
                { path: "add", element: <MikrotikDeviceForm />, handle: SHEET_MD },
                { path: "update/:recordId", element: <MikrotikDeviceForm />, handle: SHEET_MD },
              ],
            },
            // Страница записи мониторинга — общая для инвентарных и standalone
            // устройств; правка — в шторке на месте (вложенный маршрут update).
            // id — чтобы шторка расписания читала данные записи через
            // useRouteLoaderData, не запрашивая их второй раз.
            {
              path: "devices/mikrotik/records/:recordId",
              id: "mikrotik-record",
              element: <MikrotikRecordPage />,
              loader: mikrotikRecordLoader,
              children: [
                { path: "update", element: <MikrotikDeviceForm />, handle: SHEET_MD },
                // Расписание экспорта — своя шторка: у параметров verify-on-save,
                // а право у расписания другое (manageConfigs)
                {
                  path: "schedule",
                  element: <MikrotikScheduleForm />,
                  action: mikrotikScheduleAction,
                  handle: { can: { mikrotik: ["manageConfigs"] }, ...SHEET_MD },
                },
              ],
            },
            // Reports
            // Легаси-отчёт по работам влился в «Архив» (сегмент «Работы») —
            // постоянный редирект, закладки сотрудников не ломаются
            {
              path: "report/work",
              loader: () => redirect("/archive?view=works"),
            },
            {
              // Сводка IP-адресации парка Mikrotik: свой чанк, как у остальных
              // отчётов, — открывают её из тулбара мониторинга, а не с каждой
              // страницы (xlsx выгрузки подгружается ещё позже, по нажатию).
              path: "report/networks",
              handle: { can: { mikrotik: ["read"] } },
              lazy: async () => {
                const networksModule = await import("./pages/Report/Networks");
                return {
                  Component: networksModule.default,
                  loader: networksModule.loader,
                };
              },
            },
            {
              // Отчёт «Компании» (бывшая «Аналитика»): recharts и логика отчёта
              // уезжают в свой чанк и не грузятся тем, кто отчёт не открывает
              // (протухший после деплоя чанк перезагружает vite:preloadError).
              path: "report/companies",
              handle: { can: { report: ["companies"] } },
              lazy: async () => {
                const companiesModule = await import(
                  "./pages/Report/Companies"
                );
                return {
                  Component: companiesModule.default,
                  loader: companiesModule.loader,
                };
              },
            },
            {
              // Второй уровень отчёта — карточка компании
              path: "report/companies/:companyId",
              lazy: async () => {
                const cardModule = await import("./pages/Report/CompanyReport");
                return {
                  Component: cardModule.default,
                  loader: cardModule.loader,
                };
              },
            },
            {
              // Третий уровень — карточка подразделения клиента
              path: "report/companies/:companyId/subdivisions/:subdivisionId",
              lazy: async () => {
                const cardModule = await import(
                  "./pages/Report/SubdivisionReport"
                );
                return {
                  Component: cardModule.default,
                  loader: cardModule.loader,
                };
              },
            },
            {
              // Прежний адрес «Аналитики» — закладки не ломаем, режим сохраняем
              path: "report/analytics",
              loader: ({ request }) => {
                const view = new URL(request.url).searchParams.get("view");
                return redirect(
                  view ? `/report/companies?view=${view}` : "/report/companies",
                );
              },
            },
            {
              // Календарь команды: месячная сетка на всех сотрудников — свой чанк
              path: "team/calendar",
              handle: { can: { schedule: ["read"] } },
              lazy: async () => {
                const calendarModule = await import(
                  "./pages/Team/Calendar.tsx"
                );
                return {
                  Component: calendarModule.default,
                  loader: calendarModule.loader,
                };
              },
            },
            // Прежний адрес — закладки не ломаем
            { path: "team/schedule", loader: () => redirect("/team/calendar") },
            // Finances
            // Прежний адрес раздела — закладки не ломаем
            {
              path: "finances/summary-report",
              loader: () => redirect("/finances/approval"),
            },
            // «Согласование работ»: конвейер и карточка отчёта. Ленивые чанки —
            // раздел открывают не все, а тянет он таблицы и маршрут подписей.
            {
              path: "finances/approval",
              handle: { can: { approval: ["decide"] } },
              lazy: async () => {
                const approvalModule = await import(
                  "./pages/Finances/Approval.tsx"
                );
                return {
                  Component: approvalModule.default,
                  loader: approvalModule.loader,
                };
              },
            },
            // Карточка подбора: тот же компонент, что и карточка отчёта. Статический
            // сегмент "preview" ранжируется выше, чем ":id", — конфликта нет.
            {
              path: "finances/approval/preview/:companyId/:servicePlanId/:month",
              lazy: async () => {
                const reportModule = await import(
                  "./pages/Finances/ApprovalReport.tsx"
                );
                return {
                  Component: reportModule.default,
                  loader: reportModule.previewLoader,
                };
              },
            },
            {
              path: "finances/approval/:id",
              lazy: async () => {
                const reportModule = await import(
                  "./pages/Finances/ApprovalReport.tsx"
                );
                return {
                  Component: reportModule.default,
                  loader: reportModule.loader,
                };
              },
            },
            // «Сотрудники»: сводная по всем + отчёт выбранного сотрудника;
            // «Мой отчёт» — та же страница без выбора сотрудника (own).
            // Ленивые чанки: recharts грузится только тем, кто открыл отчёт.
            {
              path: "finances/employees",
              handle: { can: { report: ["employees"] } },
              lazy: async () => {
                const employeesModule = await import(
                  "./pages/Finances/EmployeesReport.tsx"
                );
                return {
                  Component: employeesModule.default,
                  loader: employeesModule.loader,
                };
              },
            },
            {
              path: "finances/employees/:userId",
              lazy: async () => {
                const personalModule = await import(
                  "./pages/Finances/PersonalReportPage.tsx"
                );
                return {
                  Component: personalModule.default,
                  loader: personalModule.loader,
                };
              },
            },
            {
              path: "finances/my-report",
              handle: { can: { report: ["own"] } },
              lazy: async () => {
                const personalModule = await import(
                  "./pages/Finances/PersonalReportPage.tsx"
                );
                return {
                  Component: () => <personalModule.default own />,
                  loader: personalModule.ownLoader,
                };
              },
            },
            // Прежние адреса финансовых отчётов — закладки не ломаем
            {
              path: "finances/personal-report",
              loader: ({ request }) => {
                const userId = new URL(request.url).searchParams.get("userId");
                return redirect(
                  userId
                    ? `/finances/employees/${userId}`
                    : "/finances/my-report",
                );
              },
            },
            {
              path: "finances/employee-report",
              loader: () => redirect("/finances/employees"),
            },
            // Preferences
            {
              path: "preferences",
              handle: { can: { settings: ["read"] } },
              element: <Preferences />,
              loader: prefsLoader,
              action: prefsAction,
            },
          ],
        },
      ],
    },
  ]);
  return <RouterProvider router={router} />;
}

export default App;
