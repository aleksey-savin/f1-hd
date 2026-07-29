import { useLoaderData } from "react-router";

import FormWrapper from "@/components/app/FormWrapper";

import SupplierFormFields from "./FormFields";

// Полей мало и они одной темы — форма плоская, без шагов (гайд: длинную, но
// одно-логическую форму мастером не притворяем).
const SupplierForm = ({ title, successTo }) => {
  const supplier = useLoaderData();

  return (
    <FormWrapper title={title} successTo={successTo}>
      <SupplierFormFields supplier={supplier} />
    </FormWrapper>
  );
};

export default SupplierForm;
