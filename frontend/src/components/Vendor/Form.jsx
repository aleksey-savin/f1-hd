import { useLoaderData } from "react-router";
import FormWrapper from "@/components/app/FormWrapper";
import VendorFormFields from "./FormFields";

const VendorForm = ({ title, successTo }) => {
  const vendor = useLoaderData();

  return (
    <FormWrapper title={title} successTo={successTo}>
      <VendorFormFields vendor={vendor} />
    </FormWrapper>
  );
};

export default VendorForm;
