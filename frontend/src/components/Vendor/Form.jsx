import { useLoaderData } from "react-router";
import FormWrapper from "@/components/app/FormWrapper";
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
