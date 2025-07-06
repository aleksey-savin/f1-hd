import { useState, useEffect } from "react";
import { useLoaderData } from "react-router";

import { FaNetworkWired } from "react-icons/fa";

import Transitions from "../../animations/Transition";

import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Card from "react-bootstrap/Card";

import SearchBar from "../../UI/SearchBar";

import { getLocalStorageData } from "../../util/auth";

const CompaniesNetworksReport = () => {
  const { entries } = useLoaderData();

  const [filteredEntries, setFilteredEntries] = useState(entries);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    setFilteredEntries(
      entries.filter((entry) => {
        if (entry.interface) {
          return [
            entry.address,
            entry.deviceName,
            entry.interface,
            entry.network,
            entry.comment,
          ]
            .join(" ")
            .toLowerCase()
            .includes(searchTerm);
        }
      }),
    );
  }, [searchTerm, entries]);

  const searchChangeHandler = (event) => {
    setSearchTerm(event.target.value);
  };

  return (
    <Transitions>
      <>
        <Card.Title className="mb-3 border-bottom">
          <h1 className="display-4">
            <FaNetworkWired /> Диапазоны сетей компаний
          </h1>
        </Card.Title>
        <SearchBar onChange={searchChangeHandler} />
        <Row>
          <Col>
            {entries.length > 0 && (
              <Transitions>
                <table className="table-responsive sortable">
                  <thead>
                    <tr>
                      <th>Address</th>
                      <th>Network</th>
                      <th>Interface</th>
                      <th>Identity</th>
                      <th>Comment</th>
                    </tr>
                  </thead>
                  <tbody className="table-round-bottom">
                    {filteredEntries.map((entry) => (
                      <tr
                        key={entry.id}
                        className={entry.duplicated ? "table-warning" : ""}
                      >
                        <td data-cell="address">{entry.address}</td>
                        <td data-cell="network">{entry.network}</td>
                        <td data-cell="interface">{entry.interface}</td>
                        <td data-cell="identify">{entry.deviceName}</td>
                        <td data-cell="comment">{entry.comment}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Transitions>
            )}
          </Col>
        </Row>
      </>
    </Transitions>
  );
};

export default CompaniesNetworksReport;

export async function loader() {
  document.title = "ДИАПАЗОНЫ СЕТЕЙ";

  const { token } = getLocalStorageData();

  const response = await fetch(
    `${import.meta.env.VITE_ADDRESS}/api/mikrotik-devices/report/networks`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );

  if (!response.ok) {
    throw response;
  }

  return response;
}
