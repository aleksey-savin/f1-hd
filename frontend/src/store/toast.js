import { createSlice } from '@reduxjs/toolkit';

const initialToastState = {
    variant: 'primary',
    message: '',
    show: false,    
};

const toastSlice = createSlice({
    name: 'toast',
    initialState: initialToastState,
    reducers: {
        setState(state, action) {
            state.variant = action.payload.variant;
            state.message = action.payload.message;
            state.show = action.payload.show;         
        },
    },
});

export const toastActions = toastSlice.actions;

export default toastSlice;
