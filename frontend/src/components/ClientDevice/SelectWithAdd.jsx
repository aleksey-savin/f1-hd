import Button from "react-bootstrap/Button";
import { RiAddLine } from "react-icons/ri";

import Select from "../../UI/Select";

// Select с кнопкой быстрого создания справочника рядом. Общий для мастера
// устройства и связки модели (ModelChainFields).
const SelectWithAdd = ({ addTitle, onAdd, addDisabled, ...selectProps }) => (
  <div className="d-flex gap-2">
    <div className="flex-grow-1">
      <Select {...selectProps} />
    </div>
    <Button
      variant="outline-secondary"
      title={addTitle}
      onClick={onAdd}
      disabled={addDisabled}
    >
      <RiAddLine />
    </Button>
  </div>
);

export default SelectWithAdd;
