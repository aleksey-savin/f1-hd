import { create } from "zustand";
import { toast } from "sonner";

// Глобальные тосты приложения — sonner (контейнер <Toaster/> в Root.jsx).
// API showToast(variant, message) сохранён с bootstrap-времён: variant — имя
// bootstrap-варианта. Поля show/message/variant и hideToast держались за
// UI/AlertToast; вместе с ним (редизайн входа, 01.08) они ушли.
const SONNER_BY_VARIANT = {
  success: toast.success,
  danger: toast.error,
  warning: toast.warning,
  info: toast.info,
};

const useToastStore = create(() => ({
  showToast: (variant, message) => {
    (SONNER_BY_VARIANT[variant] ?? toast)(message);
  },
}));

export default useToastStore;
