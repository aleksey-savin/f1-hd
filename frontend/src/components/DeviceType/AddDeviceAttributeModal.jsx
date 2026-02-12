import { useState } from "react";
import Modal from "react-bootstrap/Modal";
import Button from "react-bootstrap/Button";
import Form from "react-bootstrap/Form";
import DeviceAttributeFormFields from "../DeviceAttribute/FormFields";
import { getLocalStorageData } from "../../util/auth";

const AddDeviceAttributeModal = ({ show, onHide, onAttributeCreated }) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [formData, setFormData] = useState({
    code: "",
    name: "",
    valueType: "string",
    unit: "",
    options: "",
    isActive: true,
  });

  const handleClose = () => {
    setError("");
    setFormData({
      code: "",
      name: "",
      valueType: "string",
      unit: "",
      options: "",
      isActive: true,
    });
    onHide();
  };

  const handleFormChange = (data) => {
    setFormData(data);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError("");

    try {
      const { token } = getLocalStorageData();

      // Parse options if select/multiselect
      let parsedOptions = [];
      const showOptionsField =
        formData.valueType === "select" || formData.valueType === "multiselect";
      if (showOptionsField && formData.options.trim()) {
        parsedOptions = formData.options
          .split("\n")
          .filter((opt) => opt.trim())
          .map((opt) => ({
            value: opt.trim(),
            label: opt.trim(),
          }));
      }

      const attributeData = {
        code: formData.code.trim(),
        name: formData.name.trim(),
        valueType: formData.valueType,
        unit: formData.unit.trim(),
        options: parsedOptions,
        isActive: formData.isActive,
      };

      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/inventory/device-attributes/add`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token,
          },
          body: JSON.stringify(attributeData),
        },
      );

      if (response.ok) {
        const result = await response.json();
        const newAttribute = result.deviceAttribute;

        // Notify parent component with simplified attribute
        onAttributeCreated({
          _id: newAttribute._id,
          name: newAttribute.name,
          code: newAttribute.code,
        });

        handleClose();
      } else {
        const errorData = await response.json();
        setError(
          errorData.message || "Не удалось создать атрибут. Попробуйте снова.",
        );
      }
    } catch (err) {
      console.error("Error creating attribute:", err);
      setError("Произошла ошибка при создании атрибута");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal show={show} onHide={handleClose} centered size="lg">
      <Modal.Header closeButton>
        <Modal.Title>Новый атрибут устройства</Modal.Title>
      </Modal.Header>
      <Form onSubmit={handleSubmit}>
        <Modal.Body>
          {error && (
            <div className="alert alert-danger" role="alert">
              {error}
            </div>
          )}
          <DeviceAttributeFormFields
            attribute={null}
            onChange={handleFormChange}
          />
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={handleClose}>
            Отмена
          </Button>
          <Button variant="primary" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Создание..." : "Создать"}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
};

export default AddDeviceAttributeModal;
