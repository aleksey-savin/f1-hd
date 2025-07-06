import { useState, useContext } from "react";
import { useFetcher } from "react-router";

import Card from "react-bootstrap/Card";
import Form from "react-bootstrap/Form";
import { AuthedUserContext } from "../../../store/authed-user-context";

const ChecklistItem = ({ item, ticketNum, ticketResponsibles }) => {
  const { _id: userId } = useContext(AuthedUserContext);
  const fetcher = useFetcher();

  const { description, checked, _id, checkedBy } = item;

  const [itemChecked, setItemChecked] = useState(checked);

  const canClickCheckboxes = ticketResponsibles
    .map((user) => user._id.toString())
    .includes(userId);

  const itemCheckedHandler = () => {
    if (canClickCheckboxes) {
      setItemChecked(!itemChecked);
      fetcher.submit(
        {
          intent: "updateChecklistItem",
          itemId: _id,
          itemDescription: description,
          itemChecked: !itemChecked,
          ticketNum: ticketNum,
        },
        { method: "POST", action: `/tickets/${ticketNum}` },
      );
    }
  };

  return (
    <>
      <Card
        className="shadow my-3  shadow my-3"
        style={{ cursor: "pointer" }}
        onClick={itemCheckedHandler}
      >
        <Card.Body className={itemChecked ? "bg-success bg-opacity-10" : ""}>
          <Form.Check
            type="checkbox"
            disabled={!canClickCheckboxes && !itemChecked}
            checked={itemChecked}
            label={
              itemChecked && checkedBy
                ? `${description} (отметил(а) ${checkedBy?.lastName} ${checkedBy?.firstName})`
                : description
            }
            onChange={itemCheckedHandler}
          />
        </Card.Body>
      </Card>
    </>
  );
};

export default ChecklistItem;
