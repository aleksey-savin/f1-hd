import Form from "react-bootstrap/Form";
import FormControl from "react-bootstrap/FormControl";
import InputGroup from "react-bootstrap/InputGroup";

import { RiSearchLine } from "react-icons/ri";

const SearchBar = ({ onChange, size }) => {
  const submitHandler = (event) => {
    event.preventDefault();
  };
  return (
    <Form onSubmit={submitHandler}>
      <InputGroup>
        <InputGroup.Text>
          <RiSearchLine />
        </InputGroup.Text>
        <FormControl
          id="search-bar"
          size={size || "lg"}
          type="search"
          placeholder="Поиск..."
          onChange={onChange}
        />
      </InputGroup>
    </Form>
  );
};

export default SearchBar;
