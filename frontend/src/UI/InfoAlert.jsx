import Alert from "react-bootstrap/Alert";

const InfoAlert = ({ list = [] }) => {
  return (
    <Alert variant="light" className="mb-3">
      Всего в списке: {list.length}
    </Alert>
  );
};

export default InfoAlert;
