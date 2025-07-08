import { useLoaderData, useNavigate, useRevalidator } from "react-router";
import { useState, useEffect } from "react";

import { formatPrice } from "../../util/format-string";

import useSummaryReportFilterStore from "../../store/finances/report";

import Table from "react-bootstrap/Table";
import Button from "react-bootstrap/Button";
import Spinner from "react-bootstrap/Spinner";

import { RiRefreshLine } from "react-icons/ri";

import { formatShortDate } from "../../util/format-date";
import { calculateOvertime, calculateWorkTime } from "../../util/finances";
import DetailedViewOffcanvasReport from "./DetailedViewOffcanvasReport";

const PaidTable = () => {
  const filterStore = useSummaryReportFilterStore();
  const navigate = useNavigate();
  const revalidator = useRevalidator();

  const { paid } = useLoaderData();

  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = () => {
    setIsRefreshing(true);
    revalidator.revalidate();
  };

  useEffect(() => {
    if (isRefreshing && paid) {
      setIsRefreshing(false);
    }
  }, [paid]);

  useEffect(() => {
    if (isRefreshing && revalidator.state === "idle") {
      setIsRefreshing(false);
    }
  }, [revalidator.state, isRefreshing]);

  return (
    <>
      {filterStore.statuses.includes("paid") && (
        <>
          <div className="d-flex justify-content-between align-items-center mb-4">
            <h1 className="display-5 mb-0">Оплачено</h1>
            <Button
              size="lg"
              onClick={handleRefresh}
              disabled={isRefreshing}
              style={{ width: "200px" }}
            >
              {isRefreshing ? (
                <>
                  <Spinner
                    as="span"
                    animation="border"
                    size="sm"
                    role="status"
                    aria-hidden="true"
                    className="me-2"
                  />
                  Обновление...
                </>
              ) : (
                <>
                  <RiRefreshLine /> Обновить
                </>
              )}
            </Button>
          </div>
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
                      <div className="d-flex align-items-center justify-content-center gap-2">
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
                      </div>
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
