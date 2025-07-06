import { useLoaderData } from "react-router";

import { formatPrice } from "../../util/format-string";

import useSummaryReportFilterStore from "../../store/finances/report";

import Table from "react-bootstrap/Table";

import { formatShortDate } from "../../util/format-date";
import { calculateOvertime, calculateWorkTime } from "../../util/finances";
import DetailedViewOffcanvasReport from "./DetailedViewOffcanvasReport";

const PaidTable = () => {
  const filterStore = useSummaryReportFilterStore();

  const { paid } = useLoaderData();

  return (
    <>
      {filterStore.statuses.includes("paid") && (
        <>
          <h1 className="display-5">Ожидает выставления счёта</h1>
          <Table className="ms-1" bordered>
            <thead>
              <tr>
                <th>Компания</th>
                <th>Услуга</th>
                <th>Период</th>
                {/* {<th>Тариф</th> */}
                <th>Дата оплаты</th>
                <th className="text-end">Сумма</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {paid
                .sort(
                  (aReport, bReport) =>
                    new Date(aReport.periodFrom).getTime() -
                    new Date(bReport.periodFrom).getTime(),
                )
                .map((report) => (
                  <tr key={report._id}>
                    <td>{report.company.fullTitle}</td>
                    <td>{report.servicePlan.title}</td>
                    <td>{`${formatShortDate(report.periodFrom)} - ${formatShortDate(report.periodTo)}`}</td>
                    {/* <td>
                      {tariffingPlans[report.servicePlan?.tariffing?.type]}
                    </td> */}
                    <td>{formatShortDate(report.invoice.fullyPaidAt)}</td>
                    <td className="text-end">
                      {report.additionalPrice
                        ? `${formatPrice(report.price)} + ${formatPrice(report.additionalPrice)} = ${formatPrice(report.price + report.additionalPrice)}`
                        : formatPrice(report.price)}
                    </td>
                    <td>
                      <DetailedViewOffcanvasReport
                        worktimeWorks={
                          calculateWorkTime(
                            report.servicePlan.companyWorkSchedule
                              ? report.company.workSchedule
                              : report.servicePlan.customProvisionSchedule,
                            report.works,
                            report.servicePlan.tariffingPeriod,
                          ).worktimeWorks
                        }
                        overtimeWorks={
                          calculateOvertime(
                            report.servicePlan.companyWorkSchedule
                              ? report.company.workSchedule
                              : report.servicePlan.customProvisionSchedule,
                            report.works,
                            report.servicePlan.tariffingPeriod,
                          ).overtimeWorks
                        }
                        plan={report.servicePlan}
                        company={report.company}
                      />
                    </td>
                  </tr>
                ))}
            </tbody>
          </Table>
        </>
      )}
    </>
  );
};

export default PaidTable;
