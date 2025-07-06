import { createSlice } from '@reduxjs/toolkit';

const initialGetScreenState = {
    connectUrl: '',
    inviteUrl: '',
};

const getScreenSlice = createSlice({
    name: 'connection',
    initialState: initialGetScreenState,
    reducers: {
        setConnectionState(state, action) {
            state.connectUrl = action.payload.connectUrl;
            state.inviteUrl = action.payload.inviteUrl;
        },
    },
});

export const getScreenActions = getScreenSlice.actions;

export default getScreenSlice;
