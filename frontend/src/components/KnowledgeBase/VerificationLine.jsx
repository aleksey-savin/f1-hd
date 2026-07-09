import { RiEditLine } from "react-icons/ri";

import useInitialPrefsStore from "../../store/prefs";
import { getVerificationSummary } from "../../util/knowledgeNoteTypes";

import "../../UI/knowledgeBase.css";

// Состояние заметки — предложение, а не плашка. Ценность базы знаний в том, что
// заметку можно не перепроверять, поэтому кто и когда её проверил важнее самого
// факта проверки. Правка снимает отметку — об этом предупреждаем заранее, пока
// пользователь ещё не сохранил.
const VerificationLine = ({ note, isEditing = false }) => {
  const approvalPeriodDays = useInitialPrefsStore(
    (state) => state.knowledgeBase.approvalPeriodDays,
  );

  if (isEditing) {
    return (
      <p className="kb-trust kb-trust--editing mb-0">
        <RiEditLine aria-hidden="true" />
        <span>Сохранение снимет отметку «Проверено»</span>
      </p>
    );
  }

  if (!note) {
    return null;
  }

  const summary = getVerificationSummary(note, { approvalPeriodDays });
  const Icon = summary.icon;

  // Части фразы собираем массивом: у новой заметки нет ни автора правки, ни
  // даты, и лишние разделители «·» не должны появляться.
  const parts = [];
  if (summary.actorName) {
    parts.push(summary.verified ? summary.actorName : `изменил ${summary.actorName}`);
  }
  if (summary.at) {
    parts.push(summary.at);
  }
  if (summary.daysLeft !== null) {
    parts.push(
      summary.daysLeft === 0
        ? "проверка истекает сегодня"
        : `действует ещё ${summary.daysLeft} дн.`,
    );
  }

  // Проверка на исходе читается как предупреждение, а не как «всё хорошо».
  const tone = summary.expiresSoon ? "warning" : summary.bg;

  return (
    <p className={`kb-trust kb-trust--${tone} mb-0`}>
      <Icon aria-hidden="true" />
      <span className="kb-trust__state">{summary.label}</span>
      {parts.length > 0 && (
        <span className="kb-trust__meta">{parts.join(" · ")}</span>
      )}
    </p>
  );
};

export default VerificationLine;
