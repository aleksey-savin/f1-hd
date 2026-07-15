import Item from "./Item";

// Плоский список: у услуги нет оси активна/отключена (как у справочников),
// а тип тарификации уже виден в мете строки и доступен фасетом
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
