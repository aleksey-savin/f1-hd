import ItemCard from "../../UI/ItemCard";

const DeviceAttributeItem = ({ item }) => {
  const { label, name, dataType, unit, isActive } = item;

  const Title = () => {
    return <>{label}</>;
  };

  const Description = () => {
    return (
      <div className="text-muted small">
        <div>
          <strong>Имя:</strong> {name}
        </div>
        <div>
          <strong>Тип данных:</strong> {dataType}
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
      itemTitle="device-attribute"
      badges={badges}
      title={<Title />}
      description={<Description />}
    ></ItemCard>
  );
};

export default DeviceAttributeItem;
