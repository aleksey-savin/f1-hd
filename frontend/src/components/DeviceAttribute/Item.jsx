import ItemCard from "../../UI/ItemCard";

const DeviceAttributeItem = ({ item }) => {
  const { code, name, valueType, unit, isActive } = item;

  const Title = () => {
    return <>{name}</>;
  };

  const Description = () => {
    return (
      <div className="text-muted small">
        <div>
          <strong>Код:</strong> {code}
        </div>
        <div>
          <strong>Тип данных:</strong> {valueType}
          {unit && <> ({unit})</>}
        </div>
      </div>
    );
  };

  const badges = [
    { title: "активен", isActive: isActive, bg: "success" },
    { title: "отключен", isActive: !isActive, bg: "danger" },
  ];

  return (
    <ItemCard
      item={item}
      itemTitle="deviceAttribute"
      title={<Title />}
      badges={badges}
    ></ItemCard>
  );
};

export default DeviceAttributeItem;
