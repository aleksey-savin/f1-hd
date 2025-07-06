import { create } from "zustand";

const useOffcanvasStore = create((set) => ({
  isActive: false,
  setShow: () => set(() => ({ isActive: true })),
  setClose: () => set(() => ({ isActive: false })),
}));

export default useOffcanvasStore;
