import { useState, type ChangeEvent } from "react";

import { Input } from "@/components/ui/input";

// tw-двойник UI/PhoneInput.jsx: та же маска +7 (XXX) XXX-XX-XX на shadcn
// Input. Значение уходит в FormData по name; setValue — для контролируемых
// обёрток.
const formatPhoneNumber = (value: string) => {
  const digits = value.replace(/\D/g, "");

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

const PhoneInput = ({
  id = "phone",
  name = "phone",
  value = "",
  setValue,
}: {
  id?: string;
  name?: string;
  value?: string;
  setValue?: (value: string) => void;
}) => {
  const [phone, setPhone] = useState(value);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const formattedInput = formatPhoneNumber(e.target.value);
    setPhone(formattedInput);
    setValue?.(formattedInput);
  };

  return (
    <Input
      id={id}
      name={name}
      type="text"
      value={phone}
      onChange={handleChange}
      placeholder="+_ (___) ___-__-__"
      maxLength={18}
    />
  );
};

export default PhoneInput;
