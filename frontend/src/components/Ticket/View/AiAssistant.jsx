import { RiSparkling2Line } from "react-icons/ri";

import useViewTicketStore from "../../../store/view-ticket";
import AiCategory from "./AiCategory";
import AiGuide from "./AiGuide";

// Единая панель AI-ассистента: шапка-«личность» + разделы «Категория» и
// «Руководство». Тонкая презентационная оболочка — читает заявку только ради
// атрибуции (поставщик/модель) в шапке; вся логика и мутации живут в детях.
const AiAssistant = () => {
  const ticket = useViewTicketStore((state) => state.ticket);

  const aiGuide = ticket?.aiGuide;
  const provider = aiGuide?.provider;
  const model = aiGuide?.model;
  const showAttr = aiGuide?.status === "ready" && (provider || model);

  return (
    <div className="ai-assistant mt-3">
      <div className="ai-hero">
        <span className="ai-hero__icon">
          <RiSparkling2Line />
        </span>
        <div className="ai-hero__body">
          <h3 className="ai-hero__title">AI-ассистент</h3>
          <p className="ai-hero__subtitle">
            Подбор категории и руководство из базы знаний по этой заявке
          </p>
        </div>
        {showAttr && (
          <span className="ai-hero__attr" title="Поставщик и модель ИИ">
            {provider && <span>{provider}</span>}
            {provider && model && <span>·</span>}
            {model && <span className="ai-hero__model">{model}</span>}
          </span>
        )}
      </div>

      <AiCategory />
      <AiGuide />
    </div>
  );
};

export default AiAssistant;
