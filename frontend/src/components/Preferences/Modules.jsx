import { useState } from "react";

import Form from "react-bootstrap/Form";

const PrefsModules = ({ prefs }) => {
  const { timeTracking, finances, inventory, knowledgeBase } = prefs.modules;
  const [timeTrackingIsActive, setTimeTrackingIsActive] = useState(
    timeTracking?.isActive,
  );

  const [financesIsActive, setFinancesIsActive] = useState(finances?.isActive);

  const [inventoryIsActive, setInventoryIsActive] = useState(
    inventory?.isActive,
  );

  const [knowledgeBaseIsActive, setKnowledgeBaseIsActive] = useState(
    knowledgeBase?.isActive,
  );

  const timeTrackingIsActiveChangeHandler = () => {
    setTimeTrackingIsActive(!timeTrackingIsActive);
    timeTracking.isActive = !timeTrackingIsActive;
  };

  const financesIsActiveChangeHandler = () => {
    setFinancesIsActive(!financesIsActive);
    finances.isActive = !financesIsActive;
  };

  const inventoryIsActiveChangeHandler = () => {
    setInventoryIsActive(!inventoryIsActive);
    inventory.isActive = !inventoryIsActive;
  };

  const knowledgeBaseIsActiveChangeHandler = () => {
    setKnowledgeBaseIsActive(!knowledgeBaseIsActive);
    knowledgeBase.isActive = !knowledgeBaseIsActive;
  };

  return (
    <>
      <Form.Group className="mb-3">
        <Form.Check
          type="switch"
          label="База знаний"
          checked={knowledgeBaseIsActive}
          value={knowledgeBaseIsActive}
          onChange={knowledgeBaseIsActiveChangeHandler}
        />
      </Form.Group>
      <Form.Group className="mb-3">
        <Form.Check
          type="switch"
          label="Учёт времени"
          checked={timeTrackingIsActive}
          value={timeTrackingIsActive}
          onChange={timeTrackingIsActiveChangeHandler}
        />
      </Form.Group>
      <Form.Group className="mb-3">
        <Form.Check
          type="switch"
          label="Учёт финансов"
          disabled={!timeTrackingIsActive}
          checked={financesIsActive}
          value={financesIsActive}
          onChange={financesIsActiveChangeHandler}
        />
      </Form.Group>
      <Form.Group className="mb-3">
        <Form.Check
          type="switch"
          label="Учёт техники"
          checked={inventoryIsActive}
          value={inventoryIsActive}
          onChange={inventoryIsActiveChangeHandler}
        />
      </Form.Group>
    </>
  );
};

export default PrefsModules;
