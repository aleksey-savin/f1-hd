import { useSelector, useDispatch } from 'react-redux';
import { redirect } from 'react-router';

import { authActions } from '../store/auth';

const useCheckToken = () => {    
    const expiryDate = useSelector((state) => state.auth.expiryDate);
    const dispatch = useDispatch();
    if (new Date() > new Date(expiryDate)) {
        dispatch(authActions.logout());
        localStorage.removeItem('token');
        localStorage.removeItem('expiryDate');
    }

    return redirect('/auth');
};

export default useCheckToken;
