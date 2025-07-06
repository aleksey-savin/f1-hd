import { useState } from "react";

import Form from "react-bootstrap/Form";

const PrefsIntegrations = (props) => {
  const [getScreenIsActive, setGetScreenIsActive] = useState(
    props.prefs.getScreen?.isActive
  );

  const getScreenIsActiveChangeHandler = () => {
    setGetScreenIsActive(!getScreenIsActive);
    props.prefs.getScreen.isActive = !getScreenIsActive;
  };

  return (
    <>
      <Form.Group className="mb-3">
        <Form.Label>
          <h3>PRO32 Connect</h3>
        </Form.Label>
        <Form.Check
          type="switch"
          label="Использовать PRO32 Connect для удалённого подключения к клиентам"
          checked={getScreenIsActive}
          value={getScreenIsActive}
          onChange={getScreenIsActiveChangeHandler}
        />
      </Form.Group>
    </>
  );
};

export default PrefsIntegrations;
