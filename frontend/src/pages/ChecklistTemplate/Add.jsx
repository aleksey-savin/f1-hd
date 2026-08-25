import InlineForbidden from "../../components/Error/InlineForbidden";
import Form from "../../components/ChecklistTemplate/Form";
import { useCan } from "@/store/authed-user";

const AddChecklistTemplatePage = () => {
  const can = useCan();

  if (!can({ checklistTemplate: ["manage"] })) {
    return (
      <InlineForbidden
        right="checklistTemplate.manage"
        action="заводить шаблоны чек-листов"
      />
    );
  }

  return <Form title="Новый шаблон" />;
};

export default AddChecklistTemplatePage;
