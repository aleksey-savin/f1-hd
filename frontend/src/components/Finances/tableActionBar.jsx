import { Form as RouterForm } from "react-router";
import { calculateOvertime, calculateWorkTime } from "../../util/finances";
import Button from "react-bootstrap/Button";
import Tooltip from "react-bootstrap/Tooltip";
import OverlayTrigger from "react-bootstrap/OverlayTrigger";
import Spinner from "react-bootstrap/Spinner";
import Modal from "react-bootstrap/Modal"; // Add this import
import DetailedViewOffcanvas from "./DetailedViewOffcanvas";
import { AuthedUserContext } from "../../store/authed-user-context";
import { useContext, useState } from "react"; // Add useState

const TableActionBar = ({
  plan,
  data,
  amount,
  relatedWorks,
  unrelatedWorks,
}) => {
  const { permissions } = useContext(AuthedUserContext);

  const [isSubmitting, setIsSubmitting] = useState(false);

  // Add state for modal
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  const handleClose = () => setShowConfirmModal(false);
  const handleShow = () => setShowConfirmModal(true);

  const schedule = plan.companyWorkSchedule
    ? data.company.workSchedule
    : plan.customProvisionSchedule;

  return (
    <>
      {permissions.canConfirmReportActions && (
        <>
          {unrelatedWorks.length > 0 && (
            <OverlayTrigger
              overlay={
                <Tooltip id="tooltip-disabled">
                  В списке не должно быть выполненных работ, не привязанных ни к
                  одной услуге
                </Tooltip>
              }
            >
              <Button
                size="sm"
                variant="success"
                disabled
                style={{ pointerEvents: "none" }}
              >
                Утвердить
              </Button>
            </OverlayTrigger>
          )}
          {unrelatedWorks.length === 0 && (
            <>
              <Button
                size="sm"
                variant="success"
                onClick={handleShow}
                disabled={isSubmitting}
              >
                Утвердить
              </Button>

              {/* Confirmation Modal */}
              <Modal show={showConfirmModal} onHide={handleClose} centered>
                <Modal.Header closeButton>
                  <Modal.Title>Подтверждение</Modal.Title>
                </Modal.Header>
                <Modal.Body>Вы уверены, что хотите утвердить отчет?</Modal.Body>
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
                    <input
                      name="relatedWorks"
                      defaultValue={JSON.stringify(relatedWorks)}
                      hidden
                    />
                    <input
                      name="companyId"
                      defaultValue={data.company._id}
                      hidden
                    />
                    <input
                      name="servicePlanId"
                      defaultValue={plan._id}
                      hidden
                    />
                    <input name="price" defaultValue={amount.price} hidden />
                    <input
                      name="additionalPrice"
                      defaultValue={amount.additionalPrice}
                      hidden
                    />
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
            </>
          )}
          <DetailedViewOffcanvas
            worktimeWorks={
              calculateWorkTime(schedule, relatedWorks, plan.tariffingPeriod)
                .worktimeWorks
            }
            overtimeWorks={
              calculateOvertime(
                schedule,
                relatedWorks.filter(
                  (work) => !work.ticketsCategories[0].alwaysWithinPlan
                ),
                plan.tariffingPeriod
              ).overtimeWorks
            }
            plan={plan}
            company={data.company}
          />
        </>
      )}
    </>
  );
};

export default TableActionBar;
