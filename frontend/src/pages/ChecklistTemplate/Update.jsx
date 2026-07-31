import { useContext } from "react";

import InlineForbidden from "../../components/Error/InlineForbidden";
import Form from "../../components/ChecklistTemplate/Form";
import { AuthedUserContext } from "../../store/authed-user-context";

const UpdateChecklistTemplatePage = () => {
  const { permissions } = useContext(AuthedUserContext);

  if (!permissions.canAdministrateTickets) {
    return <InlineForbidden right="Администрирование заявок" />;
  }

  return <Form title="Изменить шаблон" />;
};

export default UpdateChecklistTemplatePage;
