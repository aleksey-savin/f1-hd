import useToastStore from "../store/toast-store";

import Toast from "react-bootstrap/Toast";

const AlertToast = (props) => {
  const { show, message, variant, hideToast } = useToastStore();

  const close = () => {
    hideToast();
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
