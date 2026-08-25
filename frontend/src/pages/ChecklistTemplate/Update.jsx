import InlineForbidden from "../../components/Error/InlineForbidden";
import Form from "../../components/ChecklistTemplate/Form";
import { useCan } from "@/store/authed-user";

const UpdateChecklistTemplatePage = () => {
  const can = useCan();

  if (!can({ checklistTemplate: ["manage"] })) {
    return (
      <InlineForbidden
        right="checklistTemplate.manage"
        action="изменять шаблоны чек-листов"
      />
    );
  }

  return <Form title="Изменить шаблон" />;
};

export default UpdateChecklistTemplatePage;
