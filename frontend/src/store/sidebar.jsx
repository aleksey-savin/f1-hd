import { create } from "zustand";

const useSidebarStore = create((set) => ({
  leftSidebarIsActive: false,
  rightSidebarIsActive: false,
  leftSidebarContent: <></>,
  showLeftSidebar: () => set(() => ({ leftSidebarIsActive: true })),
  closeLeftSidebar: () => set(() => ({ leftSidebarIsActive: false })),
  setLeftSidebarContent: (content) =>
    set(() => ({ leftSidebarContent: content })),
}));

export default useSidebarStore;
