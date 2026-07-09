import Form from "react-bootstrap/Form";
import FormControl from "react-bootstrap/FormControl";
import InputGroup from "react-bootstrap/InputGroup";

import { RiSearchLine } from "react-icons/ri";

// Передайте `value` — поле станет управляемым и будет очищаться вместе с
// фильтром. С одним `defaultValue` сброс фильтра оставляет запрос в поле.
const SearchBar = ({ onChange, size, defaultValue, value, autoFocus }) => {
  const submitHandler = (event) => {
    event.preventDefault();
  };
  const controlled = value !== undefined;
  return (
    <Form onSubmit={submitHandler}>
      {/* size — на всей группе, иначе иконка слева остаётся крупной и тянет
          высоту вверх независимо от размера поля. */}
      <InputGroup size={size}>
        <InputGroup.Text>
          <RiSearchLine />
        </InputGroup.Text>
        <FormControl
          id="search-bar"
          size={size || "md"}
          type="search"
          placeholder="Поиск..."
          {...(controlled ? { value } : { defaultValue: defaultValue || "" })}
          onChange={onChange}
          autoFocus={autoFocus}
        />
      </InputGroup>
    </Form>
  );
};

export default SearchBar;
