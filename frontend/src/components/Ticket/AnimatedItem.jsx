import { memo, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";

import Item from "./Item";

// Слепок «значимого» содержимого заявки. Если он меняется между фоновыми
// обновлениями — значит у уже видимой заявки что-то поменялось (статус, новый
// комментарий, ответственные, запланированные работы, ИИ-статусы) и это стоит
// подсветить. _id (ключ списка) при этом не меняется, поэтому enter-анимация
// сама по себе не сработала бы.
const contentSignature = (item) =>
  [
    item.state,
    item.deadline,
    item.responsibles?.length,
    item.latestComment?._id,
    item.scheduledWorks?.length,
    item.attachments?.length,
    item.aiSpeech?.status,
    item.aiCategory?.status,
  ].join("|");

// Затухающая обводка акцентным `primary` (#3498db) — semantics-safe для тёмной
// темы (не `info`).
const PULSE_RING = [
  "0 0 0 0 rgba(52, 152, 219, 0)",
  "0 0 0 4px rgba(52, 152, 219, 0.55)",
  "0 0 0 0 rgba(52, 152, 219, 0)",
];

const AnimatedItem = ({ item, isSelected, onSelect }) => {
  const prevSignature = useRef(contentSignature(item));
  const [justUpdated, setJustUpdated] = useState(false);

  useEffect(() => {
    const nextSignature = contentSignature(item);
    if (nextSignature === prevSignature.current) return;

    prevSignature.current = nextSignature;
    setJustUpdated(true);
    const timeoutId = setTimeout(() => setJustUpdated(false), 1600);
    return () => clearTimeout(timeoutId);
  }, [item]);

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: -8 }}
      animate={{
        opacity: 1,
        y: 0,
        scale: justUpdated ? [1, 1.01, 1] : 1,
        boxShadow: justUpdated ? PULSE_RING : "0 0 0 0 rgba(52, 152, 219, 0)",
      }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: justUpdated ? 1.6 : 0.25 }}
      style={{ borderRadius: "0.375rem" }}
    >
      <Item item={item} isSelected={isSelected} onSelect={onSelect} />
    </motion.div>
  );
};

// Мемоизация: при выделении заявки меняется только isSelected у одной карточки.
// Без memo переключение выделения перерисовывало все карточки списка (каждая —
// motion.div с layout-анимацией и тремя поповерами), отчего выделение «тупило».
// item стабилен между фоновыми обновлениями, onSelect стабилизирован useCallback
// в List — поэтому перерисовывается только переключённая карточка.
export default memo(AnimatedItem);
