import Badge from "react-bootstrap/Badge";
import Spinner from "react-bootstrap/Spinner";
import { RiAiGenerate2 } from "react-icons/ri";

// Бейдж статуса фоновой обработки аудиозаписи звонка распознаванием речи.
const AiSpeechBadge = ({ status, className = "" }) => {
  if (status === "pending") {
    return (
      <Badge
        bg="info"
        className={`d-inline-flex align-items-center gap-1 ${className}`}
      >
        <Spinner animation="border" size="sm" />
        ИИ обрабатывает запись
      </Badge>
    );
  }

  if (status === "processed") {
    return (
      <Badge bg="success" className={className}>
        <RiAiGenerate2 />
        Обработана ИИ
      </Badge>
    );
  }

  // Ошибку намеренно не показываем (засоряет интерфейс) — её видно в логе заявки.
  return null;
};

export default AiSpeechBadge;
