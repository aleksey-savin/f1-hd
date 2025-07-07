import { useState, useContext } from "react";

import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Image from "react-bootstrap/Image";
import AudioPlayer from "react-h5-audio-player";

import Card from "react-bootstrap/Card";

import { formatDate } from "../../util/format-date";

import { AuthedUserContext } from "../../store/authed-user-context";

const CommentItem = ({ comment, danger }) => {
  const { createdAt, createdBy, content, attachments } = comment;

  const { _id: userId } = useContext(AuthedUserContext);

  const [isNew, setIsNew] = useState(
    new Date() - new Date(createdAt) < 10000 ? true : false,
  );

  setTimeout(() => {
    setIsNew(false);
  }, 15000);

  return (
    <Card
      className={`shadow-sm ${
        isNew
          ? "bg-success bg-opacity-10"
          : danger
            ? "bg-danger bg-opacity-10"
            : userId.toString() === createdBy?.toString()
              ? ""
              : "bg-secondary bg-opacity-10"
      }`}
    >
      <Card.Body>
        <p>
          <Image
            src={
              createdBy.profileImagePath
                ? `${import.meta.env.VITE_API_ADDRESS}/uploads/${createdBy.profileImagePath}`
                : "/profilepic-placeholder.jpg"
            }
            style={{ maxHeight: "30px" }}
            className="me-2"
            roundedCircle
          />
          <strong className="me-2">{`${createdBy.lastName} ${createdBy.firstName}`}</strong>
          <span
            className={
              attachments.length > 0
                ? "text-body-secondary"
                : "text-body-secondary mb-0"
            }
          >{`${formatDate(createdAt)}`}</span>
        </p>
        <p className={attachments ? "mb-2" : "mb-0"}>{content}</p>
        {attachments && (
          <>
            {attachments.map((a) =>
              a.name?.indexOf(".mp3") === a.name?.length - 4 ? (
                <Row key={a.name}>
                  <Col>
                    <AudioPlayer
                      key={a.name}
                      src={`${import.meta.env.VITE_API_ADDRESS}/uploads/${a.name}`}
                    />
                  </Col>
                </Row>
              ) : (
                <Row key={a.name}>
                  <Col sm="12">
                    <a
                      href={`${import.meta.env.VITE_API_ADDRESS}/uploads/${a.name}`}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {a.name}
                    </a>
                  </Col>
                </Row>
              ),
            )}
          </>
        )}
      </Card.Body>
    </Card>
  );
};

export default CommentItem;
