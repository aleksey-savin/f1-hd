import { create } from 'zustand';

const useToastStore = create((set) => ({
  variant: 'primary',
  message: '',
  show: false,

  setState: (payload) => set({
    variant: payload.variant,
    message: payload.message,
    show: payload.show,
  }),

  showToast: (variant, message) => set({
    variant,
    message,
    show: true,
  }),

  hideToast: () => set({
    show: false,
  }),
}));

export default useToastStore;
