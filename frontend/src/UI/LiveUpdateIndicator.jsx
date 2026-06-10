import { motion } from "framer-motion";

// Ненавязчивый индикатор фонового автообновления: зелёная точка + подпись
// «обновлено». При смене timestamp (новый успешный опрос) точка коротко
// пульсирует. Цвета — success/muted, без `info` (правило тёмной темы,
// docs/ux-ui-guide.md).
const LiveUpdateIndicator = ({ timestamp, label = "обновлено" }) => {
  if (!timestamp) return null;

  return (
    <span className="d-inline-flex align-items-center gap-1 text-muted small">
      <motion.span
        key={timestamp}
        className="text-success"
        style={{ fontSize: "0.6rem", lineHeight: 1 }}
        initial={{ scale: 1, opacity: 0.6 }}
        animate={{ scale: [1, 1.9, 1], opacity: [0.6, 1, 0.6] }}
        transition={{ duration: 1.4, ease: "easeOut" }}
        aria-hidden="true"
      >
        ●
      </motion.span>
      {label}
    </span>
  );
};

export default LiveUpdateIndicator;
