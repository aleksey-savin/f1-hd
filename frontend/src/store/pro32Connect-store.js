import { create } from "zustand";

const usePro32ConnectStore = create((set, get) => ({
  connectUrl: "",
  inviteUrl: "",

  setConnectionState: (payload) =>
    set({
      connectUrl: payload.connectUrl,
      inviteUrl: payload.inviteUrl,
    }),

  clearConnectionState: () =>
    set({
      connectUrl: "",
      inviteUrl: "",
    }),

  // Pro32 Connect specific methods
  setPro32ConnectUrls: (connectUrl, inviteUrl) =>
    set({
      connectUrl,
      inviteUrl,
    }),

  isConnectionReady: () => {
    const state = get();
    return !!(state.connectUrl && state.inviteUrl);
  },

  // Helper method to get connection info
  getConnectionInfo: () => {
    const state = get();
    return {
      connectUrl: state.connectUrl,
      inviteUrl: state.inviteUrl,
      isReady: !!(state.connectUrl && state.inviteUrl),
    };
  },
}));

export default usePro32ConnectStore;
