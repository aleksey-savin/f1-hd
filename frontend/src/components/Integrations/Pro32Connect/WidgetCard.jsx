import { BrowserView } from "react-device-detect";
import Card from "react-bootstrap/Card";
import Row from "react-bootstrap/Row";

const Pro32ConnectWidgetCard = () => {
  return (
    <>
      <BrowserView>
        <Card className="pb-4 pt-5 shadow">
          <Card.Body>
            <Row className="justify-content-center">
              <h2 className="text-center mb-3">Удалённое подключение</h2>
              <iframe
                title="Удалённое подключение"
                style={{ width: "400px", height: "277px", border: "0 none" }}
                src="https://pro32connect.ru/invite/widget?token=V5vaQFwC5hcViVtL6Nl8NB4dKgXheg3n&v=2"
              ></iframe>
            </Row>
          </Card.Body>
        </Card>
      </BrowserView>
    </>
  );
};

export default Pro32ConnectWidgetCard;
