import ItemCard from "../../UI/ItemCard";
import Badge from "react-bootstrap/Badge";

const DeviceModelItem = ({ item }) => {
  const { name, deviceTypeId, vendorId, attributes } = item;

  const Title = () => {
    return (
      <>
        {vendorId?.name} {name}
      </>
    );
  };

  const Description = () => {
    return (
      <div className="text-muted small">
        {deviceTypeId?.name && (
          <div className="mb-1">
            <strong>Тип:</strong> {deviceTypeId.name}
          </div>
        )}
        {attributes && attributes.length > 0 && (
          <div className="mt-2">
            {attributes.slice(0, 3).map((attr, index) => (
              <div key={index}>
                <strong>{attr.attributeId?.label}:</strong>{" "}
                {attr.value}
                {attr.attributeId?.unit && <> {attr.attributeId.unit}</>}
              </div>
            ))}
            {attributes.length > 3 && (
              <div className="text-muted fst-italic mt-1">
                +{attributes.length - 3} атрибутов
              </div>
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
      bg: "info",
    },
  ];

  return (
    <ItemCard
      item={item}
      itemTitle="device-model"
      badges={badges}
      title={<Title />}
      description={<Description />}
    ></ItemCard>
  );
};

export default DeviceModelItem;
