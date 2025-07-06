import useUserFilterStore from "../../store/lists/users";

import FilterContainer from "../../UI/FilterContainer";

const ServicePlanFilter = ({
  setShowOffcanvas = () => {
    return null;
  },
}) => {
  const filterStore = useUserFilterStore();

  const resetFilterHandler = () => {
    filterStore.resetFilter();
  };

  return (
    <FilterContainer
      setShowOffcanvas={setShowOffcanvas}
      resetFilterHandler={resetFilterHandler}
    ></FilterContainer>
  );
};
export default ServicePlanFilter;
