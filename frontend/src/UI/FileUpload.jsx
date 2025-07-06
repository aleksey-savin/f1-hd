import { useRef, useState } from "react";

import Form from "react-bootstrap/Form";

const FileUpload = (props) => {
  const filePickerRef = useRef();

  const [isValid, setIsValid] = useState();

  const pickedHandler = (event) => {
    // let fileIsValid = isValid;
    if (event.target.files && event.target.files.length !== 0) {
      const pickedFiles = event.target.files;
      props.setFiles(pickedFiles);
      setIsValid(true);
      // fileIsValid = true;
    } else {
      setIsValid(false);
      // fileIsValid = false;
    }
  };
  return (
    <>
      <Form.Group>
        {props.showLabel && <Form.Label>Прикрепить файлы</Form.Label>}
        <Form.Control
          id="attachments"
          name="attachments"
          type="file"
          accept=".png,.jpeg,.jpg,.pdf,.rtf,.txt,.docx,.xlsx,.pptx,.rar,.tar,.zip,.7z,.mp3,.mp4"
          multiple
          ref={filePickerRef}
          onChange={pickedHandler}
        />
        {props.showText && (
          <Form.Text muted>
            Изображения png, jpeg, jpg, документы pdf, rtf, docx, xlsx, pptx ,
            архивы rar, tar, zip, 7z, медиа mp3, mp4
          </Form.Text>
        )}
      </Form.Group>
      {!isValid && <p>{props.errorText}</p>}
    </>
  );
};

export default FileUpload;
