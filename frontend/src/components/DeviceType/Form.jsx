import { useLoaderData } from "react-router";

import FormWrapper from "@/components/app/FormWrapper";

import DeviceTypeFormFields from "./FormFields";

const DeviceTypeForm = ({ title }) => {
  const loaderData = useLoaderData();

  return (
    <FormWrapper title={title}>
      <DeviceTypeFormFields
        deviceType={loaderData?.deviceType}
        availableDeviceTypes={loaderData?.availableDeviceTypes || []}
        availableAttributes={loaderData?.availableAttributes || []}
      />
    </FormWrapper>
  );
};

export default DeviceTypeForm;
