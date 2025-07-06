import { useState, useEffect } from "react";
import Form from "react-bootstrap/Form";
import { getLocalStorageData } from "../../../util/auth";
import BackgroundUpload from "./BackgroundImageUpload";

const Appearance = ({ user }) => {
  const [darkMode, setDarkMode] = useState(getLocalStorageData()?.darkMode);

  const darkModeHandler = () => {
    setDarkMode(!darkMode);
    window.location.reload();
  };

  useEffect(() => {
    if (darkMode) {
      localStorage.setItem("darkMode", true);
    } else {
      localStorage.setItem("darkMode", false);
    }
  }, [darkMode]);
  return (
    <>
      <Form.Group className="mb-3">
        <Form.Check
          type="switch"
          label="Тёмная тема"
          checked={darkMode}
          onChange={darkModeHandler}
        />
      </Form.Group>
      <Form.Group>
        <Form.Label>Фоновое изображение</Form.Label>
        <BackgroundUpload user={user} />
      </Form.Group>
    </>
  );
};

export default Appearance;
