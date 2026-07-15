import { useLoaderData } from "react-router";

import FormWrapper from "@/components/app/FormWrapper";

import TicketCategoryFormFields from "./FormFields";

const TicketCategoryForm = ({ title }) => {
  const { ticketCategory, usersList, servicePlansList } = useLoaderData();

  return (
    <FormWrapper title={title}>
      <TicketCategoryFormFields
        ticketCategory={ticketCategory}
        usersList={usersList}
        servicePlansList={servicePlansList}
      />
    </FormWrapper>
  );
};

export default TicketCategoryForm;
