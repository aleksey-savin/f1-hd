import { configureStore } from "@reduxjs/toolkit";

import authReducer from "./auth";
import getScreenSlice from "./getScreen";
import toastSlice from "./toast";

const store = configureStore({
  reducer: {
    auth: authReducer,
    toast: toastSlice.reducer,
    getScreen: getScreenSlice.reducer,
  },
});

export default store;
