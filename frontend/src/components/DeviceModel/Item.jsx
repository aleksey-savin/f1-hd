import ItemCard from "../../UI/ItemCard";
import Badge from "react-bootstrap/Badge";

const DeviceModelItem = ({ item }) => {
  const { name, deviceTypeId, vendorId, compatibleWithModelIds } = item;

  const Title = () => {
    return (
      <>
        {vendorId?.name} {name || "(Без названия)"}
      </>
    );
  };

  const Description = () => {
    return (
      <div className="text-muted small">
        {compatibleWithModelIds && compatibleWithModelIds.length > 0 && (
          <div className="mt-2">
            <strong>Совместимо с:</strong>{" "}
            {compatibleWithModelIds.slice(0, 3).map((model) => (
              <Badge key={model._id} bg="secondary" className="me-1">
                {model.name || "Без названия"}
              </Badge>
            ))}
            {compatibleWithModelIds.length > 3 && (
              <span className="text-muted fst-italic">
                +{compatibleWithModelIds.length - 3} моделей
              </span>
            )}
          </div>
        )}
      </div>
    );
  };

  const badges = [
    {
      title: deviceTypeId?.name,
      isActive: deviceTypeId?.name,
      bg: "secondary",
    },
  ];

  return (
    <ItemCard
      item={item}
      itemTitle="deviceModel"
      detailsButton
      badges={badges}
      title={<Title />}
      description={<Description />}
      viewRoute={`/inventory/device-models/${item._id}`}
    ></ItemCard>
  );
};

export default DeviceModelItem;
