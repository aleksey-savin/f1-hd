import ItemCard from "../../UI/ItemCard";

const VendorItem = ({ item }) => {
  const { name, isActive } = item;

  const Title = () => {
    return <>{name}</>;
  };

  const badges = [
    { title: "активен", isActive: isActive, bg: "success" },
    { title: "отключен", isActive: !isActive, bg: "danger" },
  ];

  return (
    <ItemCard
      item={item}
      itemTitle="vendor"
      badges={badges}
      title={<Title />}
    ></ItemCard>
  );
};

export default VendorItem;
