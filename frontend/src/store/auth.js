import { createSlice } from "@reduxjs/toolkit";

const initialAuthState = {
  isLoggedIn: false,
  token: localStorage.getItem("token") || "",
  expiryDate: localStorage.getItem("expiryDate") || "",
  userId: localStorage.getItem("userId") || "",
  userName: "",
  isAdmin: false,
};

const authSlice = createSlice({
  name: "authentication",
  initialState: initialAuthState,
  reducers: {
    login(state, action) {
      state.isLoggedIn = true;
      state.token = action.payload.token;
      state.expiryDate = action.payload.expiresIn;
      state.userId = action.payload.userId;
      state.userName = action.payload.userName;
    },
    logout(state) {
      state.isLoggedIn = false;
      state.token = "";
      state.expiryDate = "";
      state.userId = "";
      state.userName = "";
      state.isAdmin = false;
    },
    setProps(state, action) {
      state.isLoggedIn = action.payload.isLoggedIn;
      state.isAdmin = action.payload.isAdmin;
      state.userId = action.payload.userId;
      state.userName = action.payload.userName;
    },
  },
});

export const authActions = authSlice.actions;

export default authSlice.reducer;
