import { useLoaderData } from "react-router";
import FormWrapper from "../../UI/FormWrapper";
import DeviceAttributeFormFields from "./FormFields";

const DeviceAttributeForm = ({ title }) => {
  const attribute = useLoaderData();

  return (
    <FormWrapper title={title}>
      <DeviceAttributeFormFields attribute={attribute} />
    </FormWrapper>
  );
};

export default DeviceAttributeForm;
