import { useDraftSection } from "@/components/app/draft-context";

// Оболочка секции «Настроек системы»: кладёт тело секции в черновик страницы
// (app/draft-context). Своей кнопки у секции нет — сохраняет одна плашка внизу
// (app/DraftBar), и уходит одно тело на частичный POST: бэкенд обновляет только
// присланные группы. Секция без сохранения (сервисные действия) этой обёрткой
// не пользуется.
const SectionForm = ({ buildPayload, children }) => {
  useDraftSection(buildPayload);

  return <>{children}</>;
};

export default SectionForm;
