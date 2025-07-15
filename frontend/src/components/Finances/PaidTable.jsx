import { useLoaderData, useRevalidator, useFetcher } from "react-router";
import { useState, useEffect, useContext } from "react";

import { formatPrice } from "../../util/format-string";

import useSummaryReportFilterStore from "../../store/finances/report";
import { AuthedUserContext } from "../../store/authed-user-context";

import Table from "react-bootstrap/Table";
import Button from "react-bootstrap/Button";
import Spinner from "react-bootstrap/Spinner";
import Modal from "react-bootstrap/Modal";

import { RiRefreshLine, RiArchiveLine } from "react-icons/ri";

import { formatShortDate } from "../../util/format-date";
import DetailedViewOffcanvasReport from "./DetailedViewOffcanvasReport";

const PaidTable = () => {
  const filterStore = useSummaryReportFilterStore();
  const revalidator = useRevalidator();
  const fetcher = useFetcher();
  const { permissions } = useContext(AuthedUserContext);

  const { paid } = useLoaderData();

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [reportToArchive, setReportToArchive] = useState(null);

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

  const handleArchiveClick = (report) => {
    setReportToArchive(report);
    setShowArchiveModal(true);
  };

  const handleArchiveConfirm = () => {
    if (reportToArchive) {
      const formData = new FormData();
      formData.append("intent", "archiveReport");
      formData.append("reportId", reportToArchive._id);
      fetcher.submit(formData, { method: "POST" });
      setShowArchiveModal(false);
      setReportToArchive(null);
    }
  };

  const handleArchiveCancel = () => {
    setShowArchiveModal(false);
    setReportToArchive(null);
  };

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
                          works={report.works}
                          plan={report.servicePlan}
                          company={report.company}
                        />
                        {permissions.canConfirmReportActions && (
                          <Button
                            variant="outline-secondary"
                            size="sm"
                            disabled={fetcher.state === "submitting"}
                            title="Архивировать отчёт"
                            onClick={() => handleArchiveClick(report)}
                          >
                            {fetcher.state === "submitting" &&
                            fetcher.formData?.get("reportId") === report._id ? (
                              <Spinner
                                as="span"
                                animation="border"
                                size="sm"
                                role="status"
                                aria-hidden="true"
                              />
                            ) : (
                              <RiArchiveLine />
                            )}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </Table>

          {/* Archive Confirmation Modal */}
          <Modal centered show={showArchiveModal} onHide={handleArchiveCancel}>
            <Modal.Header closeButton>
              <Modal.Title>Подтверждение архивирования</Modal.Title>
            </Modal.Header>
            <Modal.Body>
              {reportToArchive && (
                <>
                  <p>Вы уверены, что хотите архивировать отчёт?</p>
                  <p>
                    <strong>Компания:</strong>{" "}
                    {reportToArchive.company.fullTitle}
                  </p>
                  <p>
                    <strong>Услуга:</strong> {reportToArchive.servicePlan.title}
                  </p>
                  <p>
                    <strong>Период:</strong>{" "}
                    {`${formatShortDate(reportToArchive.periodFrom)} - ${formatShortDate(reportToArchive.periodTo)}`}
                  </p>
                  <p className="text-muted mt-3">
                    После архивирования отчёт больше не будет отображаться в
                    списке оплаченных отчётов.
                  </p>
                </>
              )}
            </Modal.Body>
            <Modal.Footer>
              <Button variant="secondary" onClick={handleArchiveCancel}>
                Отмена
              </Button>
              <Button
                variant="primary"
                onClick={handleArchiveConfirm}
                disabled={fetcher.state === "submitting"}
              >
                {fetcher.state === "submitting" ? (
                  <>
                    <Spinner
                      as="span"
                      animation="border"
                      size="sm"
                      role="status"
                      aria-hidden="true"
                      className="me-2"
                    />
                    Архивирование...
                  </>
                ) : (
                  "Архивировать"
                )}
              </Button>
            </Modal.Footer>
          </Modal>
        </>
      )}
    </>
  );
};

export default PaidTable;
