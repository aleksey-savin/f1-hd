import FormWrapper from "@/components/app/FormWrapper";

import LocationFormFields from "./FormFields";

const LocationForm = ({
  location: initialLocation,
  companies = [],
  users = [],
  parentLocations = [],
  subdivisions = [],
  preselectedCompany = null,
  preselectedParent = null,
  successTo,
}) => {
  // Режим определяет загруженное расположение, а не params.id: на вложенном
  // маршруте карточки (/inventory/locations/:id/add) params.id — это родитель.
  const isEdit = Boolean(initialLocation);

  return (
    <FormWrapper
      title={isEdit ? "Изменить расположение" : "Новое расположение"}
      successTo={successTo}
    >
      <LocationFormFields
        location={initialLocation}
        companies={companies}
        users={users}
        parentLocations={parentLocations}
        subdivisions={subdivisions}
        preselectedCompany={preselectedCompany}
        preselectedParent={preselectedParent}
      />
    </FormWrapper>
  );
};

export default LocationForm;
