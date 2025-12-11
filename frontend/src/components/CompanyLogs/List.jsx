import CompanyLogItem from "./Item";

const CompanyLogsList = ({ items = [], company, permissions }) => {
  return (
    <>
      {items.map((item) => (
        <CompanyLogItem
          key={item._id}
          item={item}
          company={company}
          permissions={permissions}
        />
      ))}
    </>
  );
};

export default CompanyLogsList;
