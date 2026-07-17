import { useLoaderData } from "react-router";

import FormWrapper from "@/components/app/FormWrapper";

import DeviceTypeFormFields from "./FormFields";

const DeviceTypeForm = ({ title, successTo }) => {
  const loaderData = useLoaderData();

  return (
    <FormWrapper title={title} successTo={successTo}>
      <DeviceTypeFormFields
        deviceType={loaderData?.deviceType}
        availableDeviceTypes={loaderData?.availableDeviceTypes || []}
      />
    </FormWrapper>
  );
};

export default DeviceTypeForm;
