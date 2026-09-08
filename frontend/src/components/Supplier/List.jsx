import Item from "./Item";

const List = ({ items = [], year = null }) => (
  <>
    {items.map((item) => (
      <Item key={item._id} item={item} year={year} />
    ))}
  </>
);

export default List;
