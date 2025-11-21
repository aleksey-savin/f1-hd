import { useState, useEffect } from "react";
import { useParams } from "react-router";
import Container from "react-bootstrap/Container";
import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Form from "react-bootstrap/Form";
import Alert from "react-bootstrap/Alert";

import { getLocalStorageData } from "../../util/auth";
import FormWrapper from "../../UI/FormWrapper";
import Select from "../../UI/Select";

const LocationForm = ({
  location: initialLocation,
  companies = [],
  users = [],
  subdivisions: initialSubdivisions = [],
  preselectedCompany = null,
}) => {
  const params = useParams();

  const isEdit = Boolean(params.id);

  const [location, setLocation] = useState({
    name: initialLocation?.name || "",
    company:
      initialLocation?.company?._id ||
      initialLocation?.company ||
      preselectedCompany ||
      "",
    subdivision:
      initialLocation?.subdivision?._id || initialLocation?.subdivision || "",
    description: initialLocation?.description || "",
    isPublic: initialLocation?.isPublic || false,
    type: initialLocation?.type || "",
    parent: initialLocation?.parent?._id || initialLocation?.parent || "",
    assignedUser:
      initialLocation?.assignedUser?._id || initialLocation?.assignedUser || "",
    defaultResponsible:
      initialLocation?.defaultResponsible?._id ||
      initialLocation?.defaultResponsible ||
      "",
    address: initialLocation?.address || "",
    floor: initialLocation?.coordinates?.floor || "",
  });

  const [subdivisions, setSubdivisions] = useState(initialSubdivisions || []);
  const [filteredUsers, setFilteredUsers] = useState([]);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (location.company) {
      fetchSubdivisions(location.company);
      // Filter users by selected company
      const companyUsers = users.filter(
        (user) =>
          user.company?._id === location.company ||
          user.company === location.company,
      );
      setFilteredUsers(companyUsers);
    } else {
      setSubdivisions([]);
      setFilteredUsers([]);
    }
  }, [location.company]);

  // Initialize filtered users on component mount
  useEffect(() => {
    if (location.company && users.length > 0) {
      const companyUsers = users.filter(
        (user) =>
          user.company?._id === location.company ||
          user.company === location.company,
      );
      setFilteredUsers(companyUsers);
    }
  }, [users, location.company]);

  // Initialize subdivisions for preselected company
  useEffect(() => {
    if (preselectedCompany && !initialLocation) {
      fetchSubdivisions(preselectedCompany);
    }
  }, [preselectedCompany, initialLocation]);

  const fetchSubdivisions = async (companyId) => {
    const { token } = getLocalStorageData();

    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/companies/${companyId}`,
        {
          headers: {
            Authorization: "Bearer " + token,
          },
        },
      );

      if (response.ok) {
        const data = await response.json();

        // Flatten nested subdivision hierarchy
        const flattenSubdivisions = (subdivisions) => {
          let result = [];

          subdivisions.forEach((subdivision) => {
            // Add the current subdivision
            result.push(subdivision);

            // Recursively add nested subdivisions
            if (
              subdivision.subdivisions &&
              subdivision.subdivisions.length > 0
            ) {
              result = result.concat(
                flattenSubdivisions(subdivision.subdivisions),
              );
            }
          });

          return result;
        };

        const allSubdivisions = flattenSubdivisions(
          data.company?.subdivisions || [],
        );
        setSubdivisions(allSubdivisions);
      }
    } catch (error) {
      console.error("Error fetching subdivisions:", error);
    }
  };

  const handleInputChange = (event) => {
    const { name, value } = event.target;
    setLocation((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSelectChange = (name, selectedOption) => {
    const value = selectedOption ? selectedOption.value : "";
    setLocation((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const pageTitle = isEdit
    ? "Редактировать расположение"
    : "Добавить расположение";

  return (
    <FormWrapper title={pageTitle}>
      <Container fluid>
        <Row>
          <Col lg={8}>
            {error && (
              <Alert variant="danger" dismissible onClose={() => setError("")}>
                {error}
              </Alert>
            )}

            {success && (
              <Alert
                variant="success"
                dismissible
                onClose={() => setSuccess("")}
              >
                {success}
              </Alert>
            )}

            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label htmlFor="company">
                    Компания
                    <span style={{ color: "red" }}>*</span>
                  </Form.Label>
                  <Select
                    id="company"
                    name="company"
                    placeholder="Выберите компанию"
                    options={
                      Array.isArray(companies)
                        ? companies.map((company) => ({
                            value: company._id,
                            label: company.alias || company.fullTitle,
                          }))
                        : []
                    }
                    value={
                      Array.isArray(companies) &&
                      companies.find((c) => c._id === location.company)
                        ? {
                            value: location.company,
                            label:
                              (Array.isArray(companies) &&
                                companies.find(
                                  (c) => c._id === location.company,
                                )?.alias) ||
                              (Array.isArray(companies) &&
                                companies.find(
                                  (c) => c._id === location.company,
                                )?.fullTitle),
                          }
                        : null
                    }
                    onChange={(selectedOption) =>
                      handleSelectChange("company", selectedOption)
                    }
                    required
                  />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label htmlFor="subdivision">Подразделение</Form.Label>
                  <Select
                    id="subdivision"
                    name="subdivision"
                    placeholder="Выберите подразделение"
                    options={
                      Array.isArray(subdivisions)
                        ? subdivisions.map((subdivision) => ({
                            value: subdivision._id,
                            label: subdivision.name,
                          }))
                        : []
                    }
                    value={
                      Array.isArray(subdivisions) &&
                      subdivisions.find((s) => s._id === location.subdivision)
                        ? {
                            value: location.subdivision,
                            label:
                              Array.isArray(subdivisions) &&
                              subdivisions.find(
                                (s) => s._id === location.subdivision,
                              )?.name,
                          }
                        : null
                    }
                    onChange={(selectedOption) =>
                      handleSelectChange("subdivision", selectedOption)
                    }
                    isDisabled={!location.company}
                    isClearable
                  />
                </Form.Group>
              </Col>
            </Row>

            <Row>
              <Col md={12}>
                <Form.Group className="mb-3">
                  <Form.Label htmlFor="name">
                    Название
                    <span style={{ color: "red" }}>*</span>
                  </Form.Label>
                  <Form.Control
                    id="name"
                    name="name"
                    type="text"
                    placeholder="Введите название"
                    value={location.name}
                    onChange={handleInputChange}
                    required
                  />
                </Form.Group>
              </Col>
            </Row>

            <Row>
              <Col md={12}>
                <Form.Group className="mb-3">
                  <Form.Label htmlFor="type">
                    Тип расположения
                    <span style={{ color: "red" }}>*</span>
                  </Form.Label>
                  <Select
                    id="type"
                    name="type"
                    placeholder="Выберите тип расположения"
                    options={[
                      { value: "building", label: "Здание" },
                      { value: "floor", label: "Этаж" },
                      { value: "room", label: "Помещение" },
                      { value: "workplace", label: "Рабочее место" },
                      { value: "storage", label: "Склад" },
                    ]}
                    value={
                      location.type
                        ? {
                            value: location.type,
                            label:
                              location.type === "building"
                                ? "Здание"
                                : location.type === "floor"
                                  ? "Этаж"
                                  : location.type === "room"
                                    ? "Помещение"
                                    : location.type === "workplace"
                                      ? "Рабочее место"
                                      : location.type === "storage"
                                        ? "Склад"
                                        : location.type,
                          }
                        : null
                    }
                    onChange={(selectedOption) =>
                      handleSelectChange("type", selectedOption)
                    }
                    required
                  />
                </Form.Group>
              </Col>
            </Row>

            {location.type === "workplace" && (
              <Row>
                <Col md={12}>
                  <Form.Group className="mb-3">
                    <Form.Label htmlFor="assignedUser">
                      Назначенный пользователь
                    </Form.Label>
                    <Select
                      id="assignedUser"
                      name="assignedUser"
                      placeholder="Выберите пользователя"
                      options={filteredUsers.map((user) => ({
                        value: user._id,
                        label: `${user.firstName} ${user.lastName}`,
                      }))}
                      value={
                        filteredUsers.find(
                          (u) => u._id === location.assignedUser,
                        )
                          ? {
                              value: location.assignedUser,
                              label:
                                filteredUsers.find(
                                  (u) => u._id === location.assignedUser,
                                )?.firstName +
                                " " +
                                filteredUsers.find(
                                  (u) => u._id === location.assignedUser,
                                )?.lastName,
                            }
                          : location.assignedUser &&
                              initialLocation?.assignedUser
                            ? {
                                value: location.assignedUser,
                                label: `${initialLocation.assignedUser.firstName || ""} ${initialLocation.assignedUser.lastName || ""}`,
                              }
                            : null
                      }
                      onChange={(selectedOption) =>
                        handleSelectChange("assignedUser", selectedOption)
                      }
                      isClearable
                    />
                  </Form.Group>
                </Col>
              </Row>
            )}

            <Form.Group className="mb-4">
              <Form.Label htmlFor="description">Описание</Form.Label>
              <Form.Control
                id="description"
                name="description"
                as="textarea"
                rows={3}
                placeholder="Введите описание (опционально)"
                value={location.description}
                onChange={handleInputChange}
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Check
                type="switch"
                id="isPublic"
                name="isPublic"
                label="Общедоступное расположение"
                checked={location.isPublic}
                onChange={(e) =>
                  setLocation((prev) => ({
                    ...prev,
                    isPublic: e.target.checked,
                  }))
                }
              />
              <Form.Text className="text-muted">
                Техника может перемещаться в это расположение даже из других
                компаний
              </Form.Text>
            </Form.Group>
          </Col>
        </Row>
      </Container>
    </FormWrapper>
  );
};

export default LocationForm;
