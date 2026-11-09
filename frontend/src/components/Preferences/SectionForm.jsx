import { useDraftSection } from "@/components/app/draft-context";

// Оболочка секции «Настроек системы»: кладёт тело секции в черновик страницы
// (app/draft-context). Своей кнопки у секции нет — сохраняет одна плашка внизу
// (app/DraftBar), и уходит одно тело на частичный POST: бэкенд обновляет только
// присланные группы. Секция без сохранения (сервисные действия) этой обёрткой
// не пользуется. Непустой blockedReason гасит «Сохранить» у изменённой секции и
// называет причину (см. useDraftSection).
/** @param {{buildPayload: () => import("@/components/app/draft-context").DraftPayload, blockedReason?: string | null, children?: import("react").ReactNode}} props */
const SectionForm = ({ buildPayload, blockedReason = null, children }) => {
  useDraftSection(buildPayload, blockedReason);

  return <>{children}</>;
};

export default SectionForm;
