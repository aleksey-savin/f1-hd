import { useState } from "react";

import Form from "react-bootstrap/Form";

const PrefsModules = ({ prefs }) => {
  const [timeTrackingIsActive, setTimeTrackingIsActive] = useState(
    prefs.modules?.timeTracking?.isActive,
  );

  const [financesIsActive, setFinancesIsActive] = useState(
    prefs.modules?.finances?.isActive,
  );

  const [inventoryIsActive, setInventoryIsActive] = useState(
    prefs.modules?.inventory?.isActive,
  );

  const timeTrackingIsActiveChangeHandler = () => {
    setTimeTrackingIsActive(!timeTrackingIsActive);
    prefs.modules.timeTracking.isActive = !timeTrackingIsActive;
  };

  const financesIsActiveChangeHandler = () => {
    setFinancesIsActive(!financesIsActive);
    prefs.modules.finances.isActive = !financesIsActive;
  };

  const inventoryIsActiveChangeHandler = () => {
    setInventoryIsActive(!inventoryIsActive);
    prefs.modules.inventory.isActive = !inventoryIsActive;
  };

  return (
    <>
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
