import { useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import AlertMessage from "@/components/app/AlertMessage";
import { InsideOverlayContext } from "@/components/app/overlay-context";

import DeviceAttributeFormFields from "../DeviceAttribute/FormFields";
import { getLocalStorageData } from "../../util/auth";

// Инлайн-создание атрибута из формы типа устройства: общий
// DeviceAttributeFormFields (onChange-контракт), fetch напрямую —
// router-action шторки не задействуется. Radix-Dialog поверх radix-Sheet —
// допустимо (в отличие от смешения с bootstrap-модалками).
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
    <Dialog
      open={show}
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
    >
      <DialogContent className="tw:sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Новый атрибут устройства</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          {error && (
            <AlertMessage
              variant="danger"
              message={error}
              className="tw:mt-0"
            />
          )}
          {/* UI/Select внутри диалога — инлайн-меню без портала */}
          <InsideOverlayContext.Provider value={true}>
            <DeviceAttributeFormFields
              attribute={null}
              onChange={handleFormChange}
            />
          </InsideOverlayContext.Provider>
          <DialogFooter className="tw:mt-4">
            <Button type="button" variant="ghost" onClick={handleClose}>
              Отмена
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Создание…" : "Создать"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default AddDeviceAttributeModal;
