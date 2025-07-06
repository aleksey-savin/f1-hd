import { create } from "zustand";

const useMobileFilterOffcanvasStore = create((set) => ({
  isActive: false,
  handleShow: () => set(() => ({ isActive: true })),
  handleClose: () => set(() => ({ isActive: false })),
}));

export default useMobileFilterOffcanvasStore;
