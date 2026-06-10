import { AnimatePresence, motion } from "framer-motion";

import CommentItem from "./Item";
import AddComment from "./Add";

import Alert from "react-bootstrap/Alert";
import useViewTicketStore from "../../store/view-ticket";

const CommentsList = () => {
  const { ticket, comments } = useViewTicketStore();

  // Копия перед сортировкой — не мутируем массив из стора.
  const sortedComments = [...comments].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
  );

  return (
    <>
      <AddComment ticket={ticket} />
      {/* initial={false} — комментарии, уже присутствующие при монтировании, не
          мигают; зелёным «проявляются» только новые, пришедшие фоновым
          обновлением или только что добавленные. */}
      <AnimatePresence initial={false}>
        {sortedComments.map((comment) => (
          <motion.div
            key={comment._id.toString()}
            layout
            initial={{
              opacity: 0,
              y: -8,
              backgroundColor: "rgba(25, 135, 84, 0.12)",
            }}
            animate={{
              opacity: 1,
              y: 0,
              backgroundColor: "rgba(25, 135, 84, 0)",
            }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, backgroundColor: { duration: 1.8 } }}
            className="mb-3 rounded"
          >
            <CommentItem comment={comment} />
          </motion.div>
        ))}
      </AnimatePresence>
      {!comments.length && <Alert variant="light">{"Ноу комментс :("}</Alert>}
    </>
  );
};

export default CommentsList;
