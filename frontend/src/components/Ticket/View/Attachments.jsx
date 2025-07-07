import AudioPlayer from "react-h5-audio-player";

import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Alert from "react-bootstrap/Alert";

const Attachments = ({ ticket }) => {
  return (
    <>
      {ticket.attachments && (
        <>
          {ticket.attachments?.map((attachment) =>
            attachment?.name.indexOf(".mp3") === attachment?.name.length - 4 ? (
              <Row key={attachment.name} className="mb-3">
                <Col>
                  <AudioPlayer
                    key={attachment?.name}
                    src={`${import.meta.env.VITE_API_ADDRESS}/uploads/${attachment?.name}`}
                  />
                </Col>
              </Row>
            ) : (
              <Row key={attachment.name} className="mb-3">
                <a
                  href={`${import.meta.env.VITE_API_ADDRESS}/uploads/${attachment?.name}`}
                  key={attachment?.name}
                  target="_blank"
                  rel="noreferrer"
                >
                  {attachment?.name}
                </a>
              </Row>
            ),
          )}
          {!ticket.attachments && (
            <Row className="mb-3">
              <Col>
                <Alert variant="light" style={{ margin: "0rem 0 2rem 0" }}>
                  Нет файлов
                </Alert>
              </Col>
            </Row>
          )}
        </>
      )}
    </>
  );
};

export default Attachments;
