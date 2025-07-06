import { useDispatch, useSelector } from "react-redux";

import { toastActions } from "../store/toast";

import Toast from "react-bootstrap/Toast";

const AlertToast = (props) => {
  const dispatch = useDispatch();
  let show = useSelector((state) => state.toast.show);
  const message = useSelector((state) => state.toast.message);
  const variant = useSelector((state) => state.toast.variant);

  const close = () => {
    dispatch(
      toastActions.setState({
        variant: variant,
        message: message,
        show: false,
      }),
    );
    if (props.setShow) {
      props.setShow(false);
    }
  };

  if (show || props.show) {
    setTimeout(close, 5000);
  }

  return (
    <Toast
      show={props.show ? props.show : show}
      bg={props.variant ? props.variant : variant}
      className="position-fixed bottom-0 end-0 z-4 m-4"
    >
      <Toast.Body>{props.message ? props.message : message}</Toast.Body>
    </Toast>
  );
};

export default AlertToast;
