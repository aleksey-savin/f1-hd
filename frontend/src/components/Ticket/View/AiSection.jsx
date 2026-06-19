// Единая обёртка раздела AI-панели: заголовок (иконка + uppercase-лейбл слева,
// действие справа) + содержимое. Используется и в AiCategory, и в AiGuide, чтобы
// не форкать мини-структуру заголовка. Разделитель между разделами рисует CSS
// (.ai-section + .ai-section).
const AiSection = ({ icon, label, action, children }) => (
  <section className="ai-section">
    <div className="ai-section__head">
      <span className="ai-section__label">
        {icon}
        {label}
      </span>
      {action}
    </div>
    {children}
  </section>
);

export default AiSection;
