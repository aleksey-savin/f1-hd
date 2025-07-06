import { useLoaderData, Form as RouterForm } from "react-router";

import { formatPrice } from "../../util/format-string";

import useSummaryReportFilterStore from "../../store/finances/report";

import Table from "react-bootstrap/Table";
import Button from "react-bootstrap/Button";

import { RiDeleteBinLine } from "react-icons/ri";

import { formatShortDate } from "../../util/format-date";
import { calculateOvertime, calculateWorkTime } from "../../util/finances";

import ConfirmPayment from "./ConfirmPayment";
import DetailedViewOffcanvasReport from "./DetailedViewOffcanvasReport";

const AwaitingPaymentTable = () => {
  const filterStore = useSummaryReportFilterStore();

  const { awaitingPayment } = useLoaderData();

  return (
    <>
      {filterStore.statuses.includes("awaitingPayment") && (
        <>
          <h1 className="display-5">Ожидаем оплаты</h1>
          <Table className="ms-1" bordered>
            <thead>
              <tr>
                <th>Компания</th>
                <th>Услуга</th>
                <th>Период</th>
                {/* {<th>Тариф</th> */}
                <th className="text-end">Сумма</th>

                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {awaitingPayment
                .sort(
                  (aReport, bReport) =>
                    new Date(aReport.periodFrom).getTime() -
                    new Date(bReport.periodFrom).getTime()
                )
                .map((report) => (
                  <tr key={report._id}>
                    <td>{report.company.fullTitle}</td>
                    <td>{report.servicePlan.title}</td>
                    <td>{`${formatShortDate(
                      report.periodFrom
                    )} - ${formatShortDate(report.periodTo)}`}</td>
                    {/* <td>
                      {tariffingPlans[report.servicePlan?.tariffing?.type]}
                    </td> */}
                    <td className="text-end">
                      {report.additionalPrice
                        ? `${formatPrice(report.price)} + ${formatPrice(
                            report.additionalPrice
                          )} = ${formatPrice(
                            report.price + report.additionalPrice
                          )}`
                        : formatPrice(report.price)}
                    </td>
                    <td>
                      <ConfirmPayment reportId={report._id} />
                      <DetailedViewOffcanvasReport
                        worktimeWorks={
                          calculateWorkTime(
                            report.servicePlan.companyWorkSchedule
                              ? report.company.workSchedule
                              : report.servicePlan.customProvisionSchedule,
                            report.works,
                            report.servicePlan.tariffingPeriod
                          ).worktimeWorks
                        }
                        overtimeWorks={
                          calculateOvertime(
                            report.servicePlan.companyWorkSchedule
                              ? report.company.workSchedule
                              : report.servicePlan.customProvisionSchedule,
                            report.works,
                            report.servicePlan.tariffingPeriod
                          ).overtimeWorks
                        }
                        plan={report.servicePlan}
                        company={report.company}
                      />
                      <RouterForm method="post" className="d-inline-block">
                        <input
                          name="reportId"
                          defaultValue={report._id}
                          hidden
                        />
                        <Button
                          className="m-1"
                          size="sm"
                          type="submit"
                          variant="danger"
                          name="intent"
                          value="deleteReport"
                        >
                          <RiDeleteBinLine />
                        </Button>
                      </RouterForm>
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

export default AwaitingPaymentTable;
