import Badge from "react-bootstrap/Badge";
import Spinner from "react-bootstrap/Spinner";

// Бейдж статуса фонового автоопределения категории заявки ИИ.
// При успешном завершении бейдж не показывается — определённая категория видна
// в самой заявке. Ошибку намеренно не показываем (засоряет интерфейс) — её видно
// в логе заявки.
const AiCategoryBadge = ({ status, className = "" }) => {
  if (status === "pending") {
    return (
      <Badge
        bg="info"
        className={`d-inline-flex align-items-center gap-1 ${className}`}
      >
        <Spinner animation="border" size="sm" />
        ИИ подбирает категорию
      </Badge>
    );
  }

  return null;
};

export default AiCategoryBadge;
