import { useLoaderData, useSearchParams } from "react-router";

import FormWrapper from "@/components/app/FormWrapper";

import DeviceTypeFormFields from "./FormFields";

const DeviceTypeForm = ({ title, successTo }) => {
  const loaderData = useLoaderData();
  // «Новый тип» из раздела списка приносит его назначение (?kind=consumable)
  const [searchParams] = useSearchParams();

  return (
    <FormWrapper title={title} successTo={successTo}>
      <DeviceTypeFormFields
        deviceType={loaderData?.deviceType}
        availableDeviceTypes={loaderData?.availableDeviceTypes || []}
        initialKind={searchParams.get("kind")}
      />
    </FormWrapper>
  );
};

export default DeviceTypeForm;
