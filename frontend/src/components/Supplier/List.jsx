import Item from "./Item";

const List = ({ items = [] }) => (
  <>
    {items.map((item) => (
      <Item key={item._id} item={item} />
    ))}
  </>
);

export default List;
