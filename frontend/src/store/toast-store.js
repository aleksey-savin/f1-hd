import { create } from "zustand";
import { toast } from "sonner";

// Глобальные тосты приложения — sonner (контейнер <Toaster/> в Root.jsx).
// API showToast(variant, message) сохранён с bootstrap-времён: variant — имя
// bootstrap-варианта. Поля show/message/variant оставлены для легаси
// UI/AlertToast, который некоторые немигрированные экраны рендерят локально
// через пропсы (store они не сетят — сюда пишет только setState/hideToast).
const SONNER_BY_VARIANT = {
  success: toast.success,
  danger: toast.error,
  warning: toast.warning,
  info: toast.info,
};

const useToastStore = create((set) => ({
  variant: "primary",
  message: "",
  show: false,

  setState: (payload) =>
    set({
      variant: payload.variant,
      message: payload.message,
      show: payload.show,
    }),

  showToast: (variant, message) => {
    (SONNER_BY_VARIANT[variant] ?? toast)(message);
  },

  hideToast: () =>
    set({
      show: false,
    }),
}));

export default useToastStore;
