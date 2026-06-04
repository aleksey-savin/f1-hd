import Button from "react-bootstrap/Button";

import { Link } from "react-router";

import { RiAddFill } from "react-icons/ri";

const AddButton = ({ to, content, onClick }) => {
  return (
    <Button as={Link} to={to} className="w-100" size="lg" onClick={onClick}>
      <RiAddFill /> {content}
    </Button>
  );
};

export default AddButton;
