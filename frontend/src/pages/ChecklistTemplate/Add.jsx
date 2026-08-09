
import InlineForbidden from "../../components/Error/InlineForbidden";
import Form from "../../components/ChecklistTemplate/Form";
import { useCan } from "@/store/authed-user";

const AddChecklistTemplatePage = () => {
  const can = useCan();

  if (!can({ ticket: ["administrate"] })) {
    return <InlineForbidden right="Администрирование заявок" />;
  }

  return <Form title="Новый шаблон" />;
};

export default AddChecklistTemplatePage;
