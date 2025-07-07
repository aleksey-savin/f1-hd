import { useRef, useState, useContext } from "react";
import { useFetcher } from "react-router";

import useHttp from "../../hooks/use-http";

import FileUpload from "../../UI/FileUpload";

import Button from "react-bootstrap/Button";
import Form from "react-bootstrap/Form";
import FormControl from "react-bootstrap/FormControl";

import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";

import { RiAddBoxLine } from "react-icons/ri";

import { getLocalStorageData } from "../../util/auth";

import useViewTicketStore from "../../store/viewTicket";

import { AuthedUserContext } from "../../store/authed-user-context";

const AddComment = ({ ticket = {} }) => {
  const fetcher = useFetcher();

  const { token } = getLocalStorageData();
  const { comments, updateComments } = useViewTicketStore();

  const authedUser = useContext(AuthedUserContext);

  const content = useRef();

  const [files, setFiles] = useState([]);

  const { sendRequest: postCommentHandler } = useHttp();

  const submitHandler = (event) => {
    event.preventDefault();

    const formData = new FormData();

    formData.append("intent", "addComment");
    formData.append("content", content.current.value);
    formData.append("ticketId", ticket._id);
    for (const singleFile of files) {
      formData.append("attachments", singleFile);
    }

    // костыль, не могу разобраться как цеплять файлы через useFetcher

    /* fetcher.submit(formData, {
            method: 'POST',
            action: `/tickets/${props.ticket.num}`,
        });

        content.current.value = '';
        setFiles([]); */

    const createComment = (data) => {
      if (data.comment) {
        const createdComment = {
          _id: data.comment._id,
          content: data.comment.content,
          ticketId: ticket._id,
          attachments: data.comment.attachments,
          createdBy: {
            _id: authedUser._id,
            lastName: authedUser.lastName,
            firstName: authedUser.firstName,
            profileImagePath: authedUser.profileImagePath,
          },
          createdAt: data.comment.createdAt,
        };

        content.current.value = "";
        setFiles([]);

        updateComments([createdComment, ...comments]);
      }
    };

    postCommentHandler(
      {
        url: `${import.meta.env.VITE_API_ADDRESS}/api/comments/add/`,
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
        },
        isFormData: true,
        body: formData,
      },
      (data) => {
        createComment(data);
      },
    );
  };

  return (
    <>
      <Form onSubmit={submitHandler}>
        <Row>
          <Col className="mb-2">
            <Form.Group>
              <FormControl
                as="textarea"
                id="content"
                name="content"
                required
                rows={2}
                ref={content}
              />
            </Form.Group>
          </Col>
        </Row>
        <Row className="mb-3 justify-content-between">
          <Col sm="7">
            <FileUpload
              id="attachments"
              name="attachments"
              setFiles={setFiles}
              files={files}
            />
          </Col>
          <Col sm="auto">
            <Form.Group>
              <Button
                type="submit"
                name="intent"
                value="addComment"
                className="w-100"
                disabled={fetcher.state !== "idle"}
              >
                <RiAddBoxLine /> Добавить
              </Button>
              <FormControl
                hidden
                id="ticketId"
                name="ticketId"
                defaultValue={ticket._id}
              />
            </Form.Group>
          </Col>
        </Row>
      </Form>
    </>
  );
};

export default AddComment;
