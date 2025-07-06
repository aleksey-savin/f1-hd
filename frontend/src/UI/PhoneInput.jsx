import React, { useState } from "react";

import Form from "react-bootstrap/Form";

const PhoneInput = ({ id = "phone", name = "phone", value = "", setValue }) => {
  const [phone, setPhone] = useState(value);

  const formatPhoneNumber = (value) => {
    // Удаляем все символы, кроме цифр
    const digits = value.replace(/\D/g, "");

    // Форматируем номер телефона
    let formattedPhone = digits;

    if (digits.length > 1) {
      formattedPhone = `+${digits[0]}`;
    }
    if (digits.length > 1) {
      formattedPhone += ` (${digits.slice(1, 4)}`;
    }
    if (digits.length >= 5) {
      formattedPhone += `) ${digits.slice(4, 7)}`;
    }
    if (digits.length >= 8) {
      formattedPhone += `-${digits.slice(7, 9)}`;
    }
    if (digits.length >= 10) {
      formattedPhone += `-${digits.slice(9, 11)}`;
    }

    return formattedPhone;
  };

  const handleChange = (e) => {
    const input = e.target.value;
    const formattedInput = formatPhoneNumber(input);
    setPhone(formattedInput);
    setValue(formattedInput);
  };

  return (
    <Form.Control
      id={id}
      name={name}
      type="text"
      value={phone}
      onChange={handleChange}
      placeholder="+_ (___) ___-__-__"
      maxLength={18} // Ограничение на длину ввода, включая форматирование
    />
  );
};

export default PhoneInput;
