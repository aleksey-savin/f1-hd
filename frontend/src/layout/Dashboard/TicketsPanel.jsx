import { useContext, useState } from "react";

import Button from "react-bootstrap/Button";
import Table from "react-bootstrap/Table";

import { TbCheckbox } from "react-icons/tb";

import { AuthedUserContext } from "../../store/authed-user-context";
import TicketsOffcanvas from "./Offcanvas";

const TicketsPanel = ({ ticketsLists = [], myTicketsLists = [] }) => {
  const { dashboard } = useContext(AuthedUserContext);

  const [show, setShow] = useState({ active: false, list: [] });

  const handleClose = () => setShow({ active: false, list: [] });
  const handleShow = (list) => setShow({ active: true, list: list });

  return (
    <div className="pb-3">
      <h1 className="display-5">
        <TbCheckbox /> Заявки
      </h1>
      <Table className="table-hover align-middle">
        <thead>
          <tr>
            <th></th>
            <th className="text-center">Активные</th>
            <th className="text-center">Созданы</th>
            <th className="text-center">Закрыты</th>
          </tr>
        </thead>
        <tbody>
          {dashboard.globalStats && (
            <tr>
              <td className="h5">
                <strong>Все</strong>
              </td>
              <td className="text-center">
                <Button
                  variant="link"
                  size="lg"
                  onClick={() => {
                    handleShow(ticketsLists[0]);
                  }}
                >
                  {ticketsLists[0].items?.length}
                </Button>
              </td>
              <td className="text-center">
                <Button
                  variant="link"
                  size="lg"
                  onClick={() => {
                    handleShow(ticketsLists[1]);
                  }}
                >
                  {ticketsLists[1].items?.length}
                </Button>
              </td>
              <td className="text-center">
                <Button
                  variant="link"
                  size="lg"
                  onClick={() => {
                    handleShow(ticketsLists[2]);
                  }}
                >
                  {ticketsLists[2].items?.length}
                </Button>
              </td>
            </tr>
          )}
          <tr>
            <td className="h5">
              <strong>Мои</strong>
            </td>
            <td className="text-center">
              <Button
                variant="link"
                size="lg"
                onClick={() => {
                  handleShow(myTicketsLists[0]);
                }}
              >
                {myTicketsLists[0].items?.length}
              </Button>
            </td>
            <td className="text-center">
              <Button
                variant="link"
                size="lg"
                onClick={() => {
                  handleShow(myTicketsLists[1]);
                }}
              >
                {myTicketsLists[1].items?.length}
              </Button>
            </td>
            <td className="text-center">
              <Button
                variant="link"
                size="lg"
                onClick={() => {
                  handleShow(myTicketsLists[2]);
                }}
              >
                {myTicketsLists[2].items?.length}
              </Button>
            </td>
          </tr>
        </tbody>
      </Table>
      <TicketsOffcanvas
        list={show.list}
        show={show}
        handleClose={handleClose}
      />
    </div>
  );
};

export default TicketsPanel;
