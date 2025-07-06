import { useState, useContext } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { isMobile } from "react-device-detect";
import Item from "./Item";
import Button from "react-bootstrap/Button";
import Modal from "react-bootstrap/Modal";

import { AuthedUserContext } from "../../store/authed-user-context";

const List = ({ items = [], onDeleteSelected }) => {
  const { permissions } = useContext(AuthedUserContext);
  const [selectedTickets, setSelectedTickets] = useState([]);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  const handleSelect = (ticketId) => {
    if (permissions.canDeleteTickets) {
      setSelectedTickets((prev) => {
        if (prev.includes(ticketId)) {
          return prev.filter((id) => id !== ticketId);
        } else {
          return [...prev, ticketId];
        }
      });
    }
  };

  const handleDeleteSelected = () => {
    setShowConfirmModal(false);
    onDeleteSelected(selectedTickets);
    setSelectedTickets([]);
  };

  const handleResetSelection = () => {
    setSelectedTickets([]);
  };

  const ConfirmDeleteModal = () => {
    return (
      <Modal
        show={showConfirmModal}
        centered
        onHide={() => setShowConfirmModal(false)}
      >
        <Modal.Header closeButton>
          <Modal.Title>Подтверждение удаления</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          Вы уверены, что хотите удалить выбранные заявки?
        </Modal.Body>
        <Modal.Footer>
          <Button
            variant="secondary"
            onClick={() => setShowConfirmModal(false)}
          >
            Отмена
          </Button>
          <Button variant="danger" onClick={handleDeleteSelected}>
            Удалить
          </Button>
        </Modal.Footer>
      </Modal>
    );
  };

  return (
    <>
      <ConfirmDeleteModal />
      {items.map((item) => (
        <Item
          key={item._id}
          item={item}
          isSelected={selectedTickets.includes(item._id)}
          onSelect={handleSelect}
        />
      ))}
      <AnimatePresence>
        {selectedTickets.length > 0 && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            transition={{ type: "spring", duration: 0.3 }}
            style={{
              position: "fixed",
              bottom: isMobile ? "6rem" : "1rem",
              left: 0,
              right: 0,
              padding: "0.5rem 1rem",
              background: "white",
              boxShadow: "0 2px 10px rgba(0,0,0,0.1)",
              zIndex: 1100,
              borderRadius: "8px",
              width: "fit-content",
              margin: "0 auto",
              display: "flex",
              justifyContent: "center",
            }}
          >
            <Button
              variant="danger"
              className="mx-2"
              onClick={() => setShowConfirmModal(true)}
            >
              Удалить выбранные ({selectedTickets.length})
            </Button>
            <Button
              variant="secondary"
              className="me-2"
              onClick={handleResetSelection}
            >
              Сбросить
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

export default List;
