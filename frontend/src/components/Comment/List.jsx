import CommentItem from "./Item";
import AddComment from "./Add";

import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Alert from "react-bootstrap/Alert";
import useViewTicketStore from "../../store/viewTicket";

const CommentsList = () => {
  const { ticket, comments } = useViewTicketStore();
  return (
    <>
      <AddComment ticket={ticket} />
      {comments.length > 0 && (
        <>
          {comments
            .sort((a, b) => {
              return new Date(b.createdAt) - new Date(a.createdAt);
            })
            .map((comment) => (
              <Row key={comment._id.toString()} className="mb-3">
                <Col>
                  <CommentItem comment={comment} />
                </Col>
              </Row>
            ))}
        </>
      )}
      {!comments.length && <Alert variant="light">{"Ноу комментс :("}</Alert>}
    </>
  );
};

export default CommentsList;
