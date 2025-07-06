import { useEffect, useState } from "react";

import Form from "react-bootstrap/Form";
import Button from "react-bootstrap/Button";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";

function generateRandomUUID() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const UpdateChecklist = ({ checklist: initialChecklist, updateChecklist }) => {
  const [checklist, setChecklist] = useState(initialChecklist || "");
  const [listItem, setListItem] = useState("");

  const listItemChangeHandler = (event) => {
    setListItem(event.target.value);
  };

  useEffect(() => {
    updateChecklist(checklist);
  }, [checklist]);

  const checklistChangeHandler = () => {
    setChecklist([
      ...checklist,
      {
        _id: generateRandomUUID(),
        description: listItem,
        checked: false,
      },
    ]);
    setListItem("");
  };

  const deleteListItem = (itemId) => {
    const updatedChecklist = checklist.filter((item) => item._id !== itemId);
    setChecklist(updatedChecklist);
  };

  return (
    <>
      <h2>Чеклист</h2>
      <ul className="list-group list-group-flush">
        {checklist.length > 0 &&
          checklist.map((item) => {
            return (
              <li className="list-group-item" key={item._id}>
                <Row>
                  <Col>
                    <Form.Control
                      name="checklist"
                      className="form-control-plaintext"
                      readOnly
                      value={item.description}
                    />
                  </Col>
                  {!item.mandatory && (
                    <Col sm="auto">
                      <Button
                        variant="link"
                        onClick={() => {
                          deleteListItem(item._id);
                        }}
                      >
                        Удалить
                      </Button>
                    </Col>
                  )}
                </Row>
              </li>
            );
          })}
        <li className="list-group-item">
          <Row>
            <Col>
              <Form.Control
                type="text"
                value={listItem}
                onChange={listItemChangeHandler}
              />
            </Col>
            <Col sm="auto">
              <Button variant="link" onClick={checklistChangeHandler}>
                Добавить
              </Button>
            </Col>
          </Row>
        </li>
      </ul>
    </>
  );
};

export default UpdateChecklist;
