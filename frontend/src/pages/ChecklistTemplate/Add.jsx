import { useContext } from "react";

import InlineForbidden from "../../components/Error/InlineForbidden";
import Form from "../../components/ChecklistTemplate/Form";
import { AuthedUserContext } from "../../store/authed-user-context";

const AddChecklistTemplatePage = () => {
  const { permissions } = useContext(AuthedUserContext);

  if (!permissions.canAdministrateTickets) {
    return <InlineForbidden right="Администрирование заявок" />;
  }

  return <Form title="Новый шаблон" />;
};

export default AddChecklistTemplatePage;
