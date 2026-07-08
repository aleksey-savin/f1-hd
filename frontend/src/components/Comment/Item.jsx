import { useState, useContext } from "react";

import Image from "react-bootstrap/Image";

import Card from "react-bootstrap/Card";

import { formatDate } from "../../util/format-date";

import { AuthedUserContext } from "../../store/authed-user-context";
import AttachmentPreview from "../../UI/AttachmentPreview";

const CommentItem = ({ comment, danger }) => {
  const { createdAt, createdBy, content, attachments, quotedText } = comment;

  const { _id: userId } = useContext(AuthedUserContext);

  const [showQuoted, setShowQuoted] = useState(false);

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
              attachments && attachments.length > 0
                ? "text-body-secondary"
                : "text-body-secondary mb-0"
            }
          >{`${formatDate(createdAt)}`}</span>
        </p>
        <p className={attachments && attachments.length > 0 ? "mb-2" : "mb-0"}>
          {content}
        </p>

        {quotedText && (
          <div className={attachments && attachments.length > 0 ? "mb-2" : ""}>
            <button
              type="button"
              className="btn btn-link btn-sm p-0 text-body-secondary text-decoration-none"
              onClick={() => setShowQuoted((prev) => !prev)}
            >
              {showQuoted
                ? "▾ Скрыть цитируемую переписку"
                : "▸ Показать цитируемую переписку"}
            </button>
            {showQuoted && (
              <p
                className="text-body-secondary mb-0 mt-1 border-start ps-3"
                style={{ whiteSpace: "pre-wrap", fontSize: "0.875em" }}
              >
                {quotedText}
              </p>
            )}
          </div>
        )}

        {attachments && attachments.length > 0 && (
          <AttachmentPreview
            attachments={attachments}
            compact={true}
            showAudioPlayer={true}
          />
        )}
      </Card.Body>
    </Card>
  );
};

export default CommentItem;
