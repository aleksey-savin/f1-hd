import { useLoaderData } from "react-router";

import FormWrapper from "@/components/app/FormWrapper";

import DeviceModelFormFields from "./FormFields";

const DeviceModelForm = ({
  title,
  presetDeviceTypeId,
  presetVendorId,
  successTo,
}) => {
  const loaderData = useLoaderData();

  // При добавлении с карточки типа/вендора родитель известен заранее (params
  // вложенного маршрута) — подставляем в форму как минимальный deviceModel
  // (FormFields читает deviceModel?.deviceTypeId?._id / vendorId?._id).
  // Полные option'ы Select резолвит из loader-справочников.
  const deviceModel =
    loaderData?.deviceModel ||
    (presetDeviceTypeId || presetVendorId
      ? {
          ...(presetDeviceTypeId
            ? { deviceTypeId: { _id: presetDeviceTypeId } }
            : {}),
          ...(presetVendorId ? { vendorId: { _id: presetVendorId } } : {}),
        }
      : undefined);

  return (
    <FormWrapper title={title} successTo={successTo}>
      <DeviceModelFormFields
        deviceModel={deviceModel}
        deviceTypes={loaderData?.deviceTypes || []}
        vendors={loaderData?.vendors || []}
        deviceModels={loaderData?.deviceModels || []}
      />
    </FormWrapper>
  );
};

export default DeviceModelForm;
