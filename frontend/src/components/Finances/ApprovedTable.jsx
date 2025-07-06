import { useLoaderData, Form as RouterForm } from "react-router";
import { useState } from "react";

import { formatPrice } from "../../util/format-string";

import useSummaryReportFilterStore from "../../store/finances/report";

import Table from "react-bootstrap/Table";

import Button from "react-bootstrap/Button";
import Modal from "react-bootstrap/Modal";
import Spinner from "react-bootstrap/esm/Spinner";

import { RiDeleteBinLine } from "react-icons/ri";

import { formatShortDate } from "../../util/format-date";
import { calculateOvertime, calculateWorkTime } from "../../util/finances";

import CreateInvoice from "./CreateInvoice";
import DetailedViewOffcanvasReport from "./DetailedViewOffcanvasReport";

const ApprovedTable = () => {
  const filterStore = useSummaryReportFilterStore();

  const { approved } = useLoaderData();

  // Add state for modal
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const handleClose = () => setShowDeleteModal(false);

  const [isSubmitting, setIsSubmitting] = useState(false);

  return (
    <>
      {filterStore.statuses.includes("approved") && (
        <>
          <h1 className="display-5">Ожидает выставления счёта</h1>
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
              {approved
                .sort(
                  (aReport, bReport) =>
                    new Date(aReport.periodFrom).getTime() -
                    new Date(bReport.periodFrom).getTime()
                )
                .map((report) => (
                  <tr key={report._id}>
                    <td>{report.company?.fullTitle}</td>
                    <td>{report.servicePlan?.title}</td>
                    <td>{`${formatShortDate(report.periodFrom)} - ${formatShortDate(report.periodTo)}`}</td>
                    {/* <td>
                      {tariffingPlans[report.servicePlan?.tariffing?.type]}
                    </td> */}
                    <td className="text-end">
                      {report.additionalPrice
                        ? `${formatPrice(report.price)} + ${formatPrice(report.additionalPrice)} = ${formatPrice(report.price + report.additionalPrice)}`
                        : formatPrice(report.price)}
                    </td>
                    <td>
                      <CreateInvoice reportId={report._id} />
                      <DetailedViewOffcanvasReport
                        worktimeWorks={
                          calculateWorkTime(
                            report.servicePlan?.companyWorkSchedule
                              ? report.company.workSchedule
                              : report.servicePlan?.customProvisionSchedule,
                            report.works,
                            report.servicePlan?.tariffingPeriod
                          ).worktimeWorks
                        }
                        overtimeWorks={
                          calculateOvertime(
                            report.servicePlan?.companyWorkSchedule
                              ? report.company.workSchedule
                              : report.servicePlan?.customProvisionSchedule,
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
                      <Modal
                        show={showDeleteModal}
                        onHide={handleClose}
                        centered
                      >
                        <Modal.Header closeButton>
                          <Modal.Title>Подтверждение</Modal.Title>
                        </Modal.Header>
                        <Modal.Body>
                          Вы уверены, что хотите удалить отчет?
                        </Modal.Body>
                        <Modal.Footer>
                          <Button variant="secondary" onClick={handleClose}>
                            Отмена
                          </Button>
                          <RouterForm
                            method="post"
                            className="d-inline-block"
                            onSubmit={() => {
                              setIsSubmitting(true);
                            }}
                          >
                            <Button
                              type="submit"
                              variant="success"
                              name="intent"
                              value="confirmReportByContractor"
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
                                  Утверждение...
                                </>
                              ) : (
                                "Утвердить"
                              )}
                            </Button>
                          </RouterForm>
                        </Modal.Footer>
                      </Modal>
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

export default ApprovedTable;
