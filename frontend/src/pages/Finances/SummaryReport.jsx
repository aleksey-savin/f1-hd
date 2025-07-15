import { useEffect } from "react";
import { redirect } from "react-router";

import { getLocalStorageData } from "../../util/auth";

import { RiDraftLine } from "react-icons/ri";

import useSidebarStore from "../../store/sidebar";

import SummaryReportFilter from "../../components/Finances/Filter";

import { BrowserView } from "react-device-detect";

import useSummaryReportFilterStore from "../../store/finances/report";
import PreviewTable from "../../components/Finances/PreviewTable";
import ApprovedTable from "../../components/Finances/ApprovedTable";
import AwaitingPaymentTable from "../../components/Finances/AwaitingPaymentTable";
import PaidTable from "../../components/Finances/PaidTable";

const SummaryReport = () => {
  const { setLeftSidebarContent } = useSidebarStore();
  const filterStore = useSummaryReportFilterStore();

  useEffect(() => {
    setLeftSidebarContent(
      <BrowserView>
        <SummaryReportFilter />
      </BrowserView>,
    );
  }, [setLeftSidebarContent, filterStore.originalList]);

  return (
    <>
      <h1 className="display-4">
        <RiDraftLine /> Отчёты по оказанным услугам
      </h1>
      <hr></hr>
      <PreviewTable />
      <ApprovedTable />
      <AwaitingPaymentTable />
      <PaidTable />
    </>
  );
};

export default SummaryReport;

export async function loader() {
  document.title = "ОТЧЁТ ПО РАБОТАМ";

  const { token } = getLocalStorageData();

  const summaryReportPreviewResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/finances/summary-report-preview`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );

  if (!summaryReportPreviewResponse.ok) {
    throw summaryReportPreviewResponse;
  }

  const activeReportsResponse = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/finances/active-reports`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );

  if (!activeReportsResponse.ok) {
    throw activeReportsResponse;
  }

  const activeReports = await activeReportsResponse.json();

  return {
    preview: await summaryReportPreviewResponse.json(),
    pendingApproval: activeReports.filter(
      (report) => report.status === "pendingApproval",
    ),
    approved: activeReports.filter((report) => report.status === "approved"),
    awaitingPayment: activeReports.filter(
      (report) => report.status === "awaitingPayment",
    ),
    paid: activeReports.filter((report) => report.status === "paid"),
    declined: activeReports.filter((report) => report.status === "declined"),
  };
}

export async function action({ request }) {
  const { token } = getLocalStorageData();

  const data = await request.formData();

  const intent = data.get("intent");

  if (intent === "confirmReportByContractor") {
    const reportData = {
      relatedWorks: JSON.parse(data.get("relatedWorks")),
      companyId: data.get("companyId"),
      servicePlanId: data.get("servicePlanId"),
      price: data.get("price"),
      additionalPrice: data.get("additionalPrice"),
    };

    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/finances/summary-report/confirm-works-by-contractor`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify(reportData),
      },
    );

    if ([400, 409].includes(response.status)) {
      return response;
    }

    if (!response.ok) {
      throw response;
    }

    return redirect(".");
  }

  if (intent === "deleteReport") {
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/finances/summary-report/delete`,
      {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({ reportId: data.get("reportId") }),
      },
    );

    if ([400, 409].includes(response.status)) {
      return response;
    }

    if (!response.ok) {
      throw response;
    }

    return redirect(".");
  }

  if (intent === "createInvoice") {
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/finances/summary-report/create-invoice`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({
          reportId: data.get("reportId"),
          invoiceNumber: data.get("invoiceNumber"),
          invoiceDate: data.get("invoiceDate"),
        }),
      },
    );

    if ([400, 409].includes(response.status)) {
      return response;
    }

    if (!response.ok) {
      throw response;
    }

    return redirect(".");
  }

  if (intent === "confirmPayment") {
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/finances/summary-report/confirm-payment`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({
          reportId: data.get("reportId"),
          fullPaymentDate: data.get("fullPaymentDate"),
        }),
      },
    );

    if ([400, 409].includes(response.status)) {
      return response;
    }

    if (!response.ok) {
      throw response;
    }

    return redirect(".");
  }

  if (intent === "archiveReport") {
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/finances/summary-report/archive`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({
          reportId: data.get("reportId"),
        }),
      },
    );

    if ([400, 409].includes(response.status)) {
      return response;
    }

    if (!response.ok) {
      throw response;
    }

    return redirect(".");
  }

  return redirect(".");
}
