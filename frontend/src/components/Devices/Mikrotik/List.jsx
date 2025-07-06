import { useContext } from "react";

import MikrotikAddressesModal from "./AddressesModal";

import Dropdown from "react-bootstrap/Dropdown";
import { Link } from "react-router";

import { AuthedUserContext } from "../../../store/authed-user-context";

const MikrotikDevicesList = ({ items = [] }) => {
  const { permissions } = useContext(AuthedUserContext);
  return (
    <>
      <table className="table-responsive sortable">
        <thead>
          <tr>
            <th>Имя</th>
            <th>Хост</th>
            <th>Модель</th>
            <th>Прошивка</th>
            <th>Адреса</th>
            <th>Описание</th>
            <th>Последнее обновление</th>
            <th>Действия</th>
          </tr>
        </thead>
        <tbody className="table-round-bottom">
          {items.map((device) => (
            <tr key={device._id}>
              <td data-cell="имя">{device.name}</td>
              <td data-cell="хост">{device.credentials.host}</td>
              <td data-cell="модель">{device.boardName}</td>
              <td data-cell="прошивка">{device.currentFirmware}</td>
              <td data-cell="адреса">
                <MikrotikAddressesModal device={device} />
              </td>
              <td data-cell="описание">{device.description}</td>
              <td data-cell="последнее обновление">
                {new Date(device.updatedAt).toLocaleDateString("ru-RU")}
              </td>

              <td data-cell="действия">
                {permissions.canManageMikrotikDevices && (
                  <Dropdown>
                    <Dropdown.Toggle variant="success">
                      Действия
                    </Dropdown.Toggle>

                    <Dropdown.Menu>
                      <Dropdown.Item
                        as={Link}
                        to={`/devices/mikrotik/update-info/${device._id}`}
                      >
                        Обновить данные
                      </Dropdown.Item>
                      {/*  <Dropdown.Item
                                              as={Link}
                                              to={`/devices/mikrotik/update-credentials/${device._id}`}
                                          >
                                              Изменить учётные данные
                                          </Dropdown.Item>
                                          <Dropdown.Item href='#/action-3'>
                                              Удалить
                                          </Dropdown.Item> */}
                    </Dropdown.Menu>
                  </Dropdown>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
};

export default MikrotikDevicesList;
