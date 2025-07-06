import React from "react";
import DatePicker from "react-datepicker";
import { Form, InputGroup } from "react-bootstrap";
import { BsCalendar3, BsXCircle } from "react-icons/bs";
import "react-datepicker/dist/react-datepicker.css";
import "./DatePickerBootstrap.css";

const DateRangePicker = ({
  startDate,
  endDate,
  onChange,
  className,
  label,
  ...props
}) => {
  return (
    <Form.Group className={className}>
      {label && <Form.Label>{label}</Form.Label>}
      <InputGroup>
        <div className="input-group-datepicker-wrapper">
          <DatePicker
            selected={startDate}
            onChange={onChange}
            startDate={startDate}
            endDate={endDate}
            selectsRange
            dateFormat="dd.MM.yyyy"
            placeholderText="Выберите период"
            className="form-control"
            wrapperClassName="datepicker-wrapper"
            popperClassName="bootstrap-datepicker-popper"
            calendarClassName="bootstrap-datepicker"
            {...props}
          />
          {(startDate || endDate) && (
            <button
              type="button"
              className="datepicker-clear-button"
              onClick={(e) => {
                e.stopPropagation();
                onChange([null, null]);
              }}
              aria-label="Clear date"
            >
              <BsXCircle size={14} />
            </button>
          )}
        </div>
        <InputGroup.Text>
          <BsCalendar3 />
        </InputGroup.Text>
      </InputGroup>
    </Form.Group>
  );
};

export default DateRangePicker;
