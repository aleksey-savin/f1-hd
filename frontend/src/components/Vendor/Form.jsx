import { useLoaderData } from "react-router";
import FormWrapper from "../../UI/FormWrapper";
import VendorFormFields from "./FormFields";

const VendorForm = ({ title }) => {
  const vendor = useLoaderData();

  return (
    <FormWrapper title={title}>
      <VendorFormFields vendor={vendor} />
    </FormWrapper>
  );
};

export default VendorForm;
