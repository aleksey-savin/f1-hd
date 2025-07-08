import {
  useLoaderData,
  Form as RouterForm,
  useNavigation,
  useNavigate,
  useRevalidator,
} from "react-router";
import { useState, useEffect } from "react";

import { formatPrice } from "../../util/format-string";

import useSummaryReportFilterStore from "../../store/finances/report";

import Table from "react-bootstrap/Table";
import Button from "react-bootstrap/Button";
import Modal from "react-bootstrap/Modal";
import Spinner from "react-bootstrap/esm/Spinner";

import { RiDeleteBinLine, RiRefreshLine } from "react-icons/ri";

import { formatShortDate } from "../../util/format-date";
import { calculateOvertime, calculateWorkTime } from "../../util/finances";

import ConfirmPayment from "./ConfirmPayment";
import DetailedViewOffcanvasReport from "./DetailedViewOffcanvasReport";

const AwaitingPaymentTable = () => {
  const filterStore = useSummaryReportFilterStore();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const revalidator = useRevalidator();

  const { awaitingPayment } = useLoaderData();

  // Add state for modal
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [reportToDelete, setReportToDelete] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletedReports, setDeletedReports] = useState(new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleClose = () => {
    setShowDeleteModal(false);
    setReportToDelete(null);
    setIsSubmitting(false);
  };

  const handleShowDeleteModal = (reportId) => {
    setReportToDelete(reportId);
    setShowDeleteModal(true);
  };

  const handleOptimisticDelete = () => {
    if (reportToDelete) {
      setDeletedReports((prev) => new Set([...prev, reportToDelete]));
      handleClose();
    }
  };

  // Close modal when navigation is complete
  useEffect(() => {
    if (navigation.state === "idle" && isSubmitting) {
      handleClose();
    }
  }, [navigation.state, isSubmitting]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    revalidator.revalidate();
  };

  useEffect(() => {
    if (isRefreshing && awaitingPayment) {
      setIsRefreshing(false);
    }
  }, [awaitingPayment]);

  useEffect(() => {
    if (isRefreshing && revalidator.state === "idle") {
      setIsRefreshing(false);
    }
  }, [revalidator.state, isRefreshing]);

  return (
    <>
      {filterStore.statuses.includes("awaitingPayment") && (
        <>
          <div className="d-flex justify-content-between align-items-center mb-4">
            <h1 className="display-5 mb-0">Ожидаем оплаты</h1>
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
                <th className="text-end">Сумма</th>

                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {awaitingPayment
                .filter((report) => !deletedReports.has(report._id))
                .sort(
                  (aReport, bReport) =>
                    new Date(aReport.periodFrom).getTime() -
                    new Date(bReport.periodFrom).getTime(),
                )
                .map((report) => (
                  <tr key={report._id}>
                    <td>{report.company.fullTitle}</td>
                    <td>{report.servicePlan.title}</td>
                    <td>{`${formatShortDate(
                      report.periodFrom,
                    )} - ${formatShortDate(report.periodTo)}`}</td>
                    {/* <td>
                      {tariffingPlans[report.servicePlan?.tariffing?.type]}
                    </td> */}
                    <td className="text-end">
                      {report.additionalPrice
                        ? `${formatPrice(report.price)} + ${formatPrice(
                            report.additionalPrice,
                          )} = ${formatPrice(
                            report.price + report.additionalPrice,
                          )}`
                        : formatPrice(report.price)}
                    </td>
                    <td>
                      <div className="d-flex align-items-center justify-content-center gap-2">
                        <ConfirmPayment reportId={report._id} />
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
                        <Button
                          className="m-1"
                          size="sm"
                          variant="danger"
                          onClick={() => handleShowDeleteModal(report._id)}
                        >
                          <RiDeleteBinLine />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </Table>
          <Modal show={showDeleteModal} onHide={handleClose} centered>
            <Modal.Header closeButton>
              <Modal.Title>Подтверждение удаления</Modal.Title>
            </Modal.Header>
            <Modal.Body>Вы уверены, что хотите удалить отчет?</Modal.Body>
            <Modal.Footer>
              <Button variant="secondary" onClick={handleClose}>
                Отмена
              </Button>
              <RouterForm
                method="post"
                className="d-inline-block"
                onSubmit={handleOptimisticDelete}
              >
                <input name="reportId" defaultValue={reportToDelete} hidden />
                <Button
                  type="submit"
                  variant="danger"
                  name="intent"
                  value="deleteReport"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <>
                      <Spinner
                        as="span"
                        animation="border"
                        size="sm"
                        role="status"
                        aria-hidden="true"
                        className="me-2"
                      />
                      Удаление...
                    </>
                  ) : (
                    "Удалить"
                  )}
                </Button>
              </RouterForm>
            </Modal.Footer>
          </Modal>
        </>
      )}
    </>
  );
};

export default AwaitingPaymentTable;
