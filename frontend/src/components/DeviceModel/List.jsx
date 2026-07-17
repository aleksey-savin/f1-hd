import Item from "./Item";

// Плоский список моделей по алфавиту (как в легаси). Карточку-контейнер рисует
// ListWrapper — здесь только строки.
const List = ({ items = [] }) => {
  return (
    <div>
      {items.map((item) => (
        <Item key={item._id} item={item} />
      ))}
    </div>
  );
};

export default List;
