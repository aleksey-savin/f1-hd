import { useLoaderData } from "react-router";
import FormWrapper from "../../UI/FormWrapper";
import DeviceModelFormFields from "./FormFields";

const DeviceModelForm = ({ title }) => {
  const loaderData = useLoaderData();

  return (
    <FormWrapper title={title}>
      <DeviceModelFormFields
        deviceModel={loaderData?.deviceModel}
        deviceTypes={loaderData?.deviceTypes || []}
        vendors={loaderData?.vendors || []}
        deviceModels={loaderData?.deviceModels || []}
        existingConfigurations={loaderData?.configurations || []}
      />
    </FormWrapper>
  );
};

export default DeviceModelForm;
