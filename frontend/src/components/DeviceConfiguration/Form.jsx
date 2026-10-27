import { useState } from "react";
import { useLoaderData } from "react-router";

import FormWrapper from "@/components/app/FormWrapper";
import AlertMessage from "@/components/app/AlertMessage";

import SpecFields from "./SpecFields";

// Форма конфигурации модели: динамические поля по атрибутам типа устройства.
// Сабмит идёт скрытым `values` (JSON), поэтому контролы неуправляемы через
// `name`, а пишут в состояние. Открывается в нижней шторке карточки модели.
const DeviceConfigurationForm = ({ title }) => {
  const loaderData = useLoaderData();
  const configuration = loaderData?.configuration;
  const deviceModel = loaderData?.deviceModel;
  const attributes = loaderData?.attributes || [];

  const [values, setValues] = useState(
    configuration?.values?.map((v) => ({
      attributeId:
        typeof v.attributeId === "object" ? v.attributeId._id : v.attributeId,
      value: v.value,
    })) || [],
  );

  const subtitle =
    [deviceModel?.vendorId?.name, deviceModel?.name]
      .filter(Boolean)
      .join(" ") || "(Без названия)";
  const typeName = deviceModel?.deviceTypeId?.name;

  return (
    <FormWrapper
      title={title}
      successTo={`/inventory/device-models/${deviceModel?._id}`}
    >
      <input
        type="hidden"
        name="deviceModelId"
        value={deviceModel?._id || ""}
      />
      <input
        type="hidden"
        name="values"
        value={JSON.stringify(
          values.filter((v) => v.value !== "" && v.value != null),
        )}
      />

      <p className="-mt-2 mb-5 text-sm text-muted-foreground">
        {subtitle}
        {typeName ? ` · ${typeName}` : ""}
      </p>

      {attributes.length === 0 ? (
        <AlertMessage
          variant="warning"
          message="У типа устройства нет характеристик. Сначала добавьте атрибуты к типу устройства, затем создавайте конфигурации."
        />
      ) : (
        <SpecFields links={attributes} values={values} onChange={setValues} />
      )}
    </FormWrapper>
  );
};

export default DeviceConfigurationForm;
