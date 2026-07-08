import Table from "react-bootstrap/Table";

// RouterOS ip-addresses of a managed device (rows that belong to a network).
const AddressesTable = ({ addresses = [] }) => {
  const networks = addresses.filter((item) => item.network);

  if (networks.length === 0) {
    return (
      <div className="text-body-secondary small">
        Нет привязанных к сети адресов
      </div>
    );
  }

  return (
    <Table responsive striped size="sm" className="align-middle mb-0">
      <thead>
        <tr>
          <th>Address</th>
          <th>Network</th>
          <th>Интерфейс</th>
        </tr>
      </thead>
      <tbody>
        {networks.map((item) => (
          <tr key={item._id}>
            <td className="font-monospace">{item.address}</td>
            <td className="font-monospace">{item.network}</td>
            <td>{item.interface}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
};

export default AddressesTable;
