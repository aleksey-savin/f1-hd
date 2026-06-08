import { useState } from "react";

import Button from "react-bootstrap/Button";
import Modal from "react-bootstrap/Modal";
import Table from "react-bootstrap/Table";
import Badge from "react-bootstrap/Badge";

import { FaNetworkWired } from "react-icons/fa";

const MikrotikAddressesModal = ({ device }) => {
  const [show, setShow] = useState(false);

  const handleClose = () => setShow(false);
  const handleShow = () => setShow(true);

  // В таблице подсетей показываем только адреса, привязанные к сети.
  const networks = (device.addresses || []).filter((item) => item.network);

  if (networks.length === 0) {
    return <span className="text-muted">—</span>;
  }

  return (
    <>
      <Button
        variant="outline-primary"
        size="sm"
        onClick={handleShow}
        className="d-inline-flex align-items-center gap-2"
      >
        <FaNetworkWired /> Адреса
        <Badge bg="secondary" pill>
          {networks.length}
        </Badge>
      </Button>

      <Modal show={show} onHide={handleClose} centered size="lg">
        <Modal.Header closeButton>
          <Modal.Title>Подсети — {device.displayName}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Table responsive striped hover size="sm" className="align-middle mb-0">
            <thead>
              <tr>
                <th>Address</th>
                <th>Network</th>
                <th>Interface</th>
                <th>Comment</th>
              </tr>
            </thead>
            <tbody>
              {networks.map((item) => (
                <tr key={item._id}>
                  <td data-cell="Address" className="font-monospace">
                    {item.address}
                  </td>
                  <td data-cell="Network" className="font-monospace">
                    {item.network}
                  </td>
                  <td data-cell="Interface">{item.interface}</td>
                  <td data-cell="Comment">
                    {item.comment || <span className="text-muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={handleClose}>
            Закрыть
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
};

export default MikrotikAddressesModal;
