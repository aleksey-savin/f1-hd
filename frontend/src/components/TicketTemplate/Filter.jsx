import { useState, useEffect, useMemo } from "react";

import useTicketTemplateFilterStore from "../../store/lists/ticket-templates";

import Accordion from "react-bootstrap/Accordion";
import AccordionHeader from "react-bootstrap/AccordionHeader";
import Form from "react-bootstrap/Form";

import FilterContainer from "../../UI/FilterContainer";

const TicketTemplateFilter = ({
  setShowOffcanvas = () => {
    return null;
  },
}) => {
  const filterStore = useTicketTemplateFilterStore();

  const companyToggleHandler = (event) => {
    const value = event.target.value;
    filterStore.updateFilter({
      ...filterStore,
      sharedCompanies: !filterStore.sharedCompanies?.includes(value)
        ? [...filterStore.sharedCompanies, value]
        : filterStore.sharedCompanies?.filter((company) => company !== value),
    });
    filterStore.applyFilter();
  };

  const userToggleHandler = (event) => {
    const value = event.target.value;
    filterStore.updateFilter({
      ...filterStore,
      sharedUsers: !filterStore.sharedUsers?.includes(value)
        ? [...filterStore.sharedUsers, value]
        : filterStore.sharedUsers?.filter((user) => user !== value),
    });
    filterStore.applyFilter();
  };

  const categoryToggleHandler = (event) => {
    const value = event.target.value;
    filterStore.updateFilter({
      ...filterStore,
      categories: !filterStore.categories.includes(value)
        ? [...filterStore.categories, value]
        : filterStore.categories.filter((category) => category !== value),
    });
    filterStore.applyFilter();
  };

  const resetFilterHandler = () => {
    filterStore.resetFilter();
  };

  const getListLengthBy = (list, itemName, item) => {
    let result = [];
    if (itemName === "sharedCompany") {
      result = list?.filter((template) =>
        template.sharedCompanies
          .map((company) => company._id)
          .includes(item._id),
      ).length;
    } else if (itemName === "sharedUser") {
      result = list?.filter((template) =>
        template.sharedUsers.map((user) => user._id).includes(item._id),
      ).length;
    } else if (itemName === "category") {
      result = list?.filter((task) => task.categoryId?._id === item._id).length;
    }

    return result;
  };

  // Получаем список компаний из всего списка заявок и исключаем дублирование
  const [sharedCompanies, setSharedCompanies] = useState([]);
  useEffect(() => {
    let array = [];
    filterStore.originalList?.forEach((item) => {
      item.sharedCompanies.forEach((sharedCompany) => {
        if (
          !array
            .map((company) => company._id.toString())
            .includes(sharedCompany._id.toString())
        ) {
          array.push({
            _id: sharedCompany._id.toString(),
            alias: `${sharedCompany.alias}`,
          });
        }
      });
    });
    setSharedCompanies(array.sort((a, b) => a.alias.localeCompare(b.alias)));
  }, [filterStore.originalList]);

  const [sharedUsers, setSharedUsers] = useState([]);
  useEffect(() => {
    let array = [];
    filterStore.originalList?.forEach((item) => {
      item.sharedUsers.forEach((sharedUser) => {
        if (
          !array
            .map((user) => user._id.toString())
            .includes(sharedUser._id.toString())
        ) {
          array.push({
            _id: sharedUser._id.toString(),
            name: `${sharedUser.lastName} ${sharedUser.firstName}`,
          });
        }
      });
    });
    setSharedUsers(array.sort((a, b) => a.name.localeCompare(b.name)));
  }, [filterStore.originalList]);

  const [categories, setCategories] = useState([]);

  useEffect(() => {
    let array = [];
    filterStore.originalList?.forEach((item) => {
      if (
        item.categoryId?._id &&
        !array
          .map((category) => category._id?.toString())
          .includes(item.categoryId._id.toString())
      ) {
        array.push({
          _id: item.categoryId._id.toString(),
          title: item.categoryId.title,
        });
      }
    });
    setCategories(array.sort((a, b) => a.title?.localeCompare(b.title)));
  }, [filterStore.originalList]);

  const sortedCompanies = useMemo(() => {
    return [...sharedCompanies].sort((a, b) => {
      const aChecked = filterStore.sharedCompanies?.includes(a._id);
      const bChecked = filterStore.sharedCompanies?.includes(b._id);
      if (aChecked === bChecked) return 0;
      return aChecked ? -1 : 1;
    });
  }, [sharedCompanies, filterStore.sharedCompanies]);

  const sortedUsers = useMemo(() => {
    return [...sharedUsers].sort((a, b) => {
      const aChecked = filterStore.sharedUsers?.includes(a._id);
      const bChecked = filterStore.sharedUsers?.includes(b._id);
      if (aChecked === bChecked) return 0;
      return aChecked ? -1 : 1;
    });
  }, [sharedUsers, filterStore.sharedUsers]);

  const sortedCategories = useMemo(() => {
    return [...categories].sort((a, b) => {
      const aChecked = filterStore.categories?.includes(a._id);
      const bChecked = filterStore.categories?.includes(b._id);
      if (aChecked === bChecked) return 0;
      return aChecked ? -1 : 1;
    });
  }, [categories, filterStore.categories]);

  return (
    <FilterContainer
      setShowOffcanvas={setShowOffcanvas}
      resetFilterHandler={resetFilterHandler}
    >
      <Accordion className="py-2" defaultActiveKey="0">
        <Accordion.Item eventKey="0">
          <AccordionHeader>
            <span
              className={`${filterStore.sharedCompanies?.length > 0 ? "text-info" : ""}`}
            >
              Компании
            </span>
          </AccordionHeader>
          <Accordion.Body style={{ maxHeight: "100svh", overflowY: "auto" }}>
            {sortedCompanies.map((company) => {
              return (
                <Form.Check
                  key={company._id}
                  className={`${filterStore.sharedCompanies?.includes(company._id) ? "text-info" : ""}
                  ${
                    getListLengthBy(
                      filterStore.filteredList,
                      "sharedCompany",
                      company,
                    ) === 0
                      ? "text-secondary"
                      : ""
                  } py-2`}
                  label={`${company.alias} (${getListLengthBy(filterStore.filteredList, "sharedCompany", company)})`}
                  value={company._id}
                  id={`resp-${company._id}`}
                  checked={filterStore.sharedCompanies?.includes(company._id)}
                  type="checkbox"
                  name="filter-group-shared-companies"
                  onChange={companyToggleHandler}
                />
              );
            })}
          </Accordion.Body>
        </Accordion.Item>
      </Accordion>
      <Accordion className="py-2" defaultActiveKey="0">
        <Accordion.Item eventKey="0">
          <AccordionHeader>
            <span
              className={`${filterStore.sharedUsers?.length > 0 ? "text-info" : ""}`}
            >
              Пользователи
            </span>
          </AccordionHeader>
          <Accordion.Body style={{ maxHeight: "100svh", overflowY: "auto" }}>
            {sortedUsers.map((user) => {
              return (
                <Form.Check
                  key={user._id}
                  className={`${filterStore.sharedUsers?.includes(user._id) ? "text-info" : ""}
                  ${
                    getListLengthBy(
                      filterStore.filteredList,
                      "sharedUser",
                      user,
                    ) === 0
                      ? "text-secondary"
                      : ""
                  } py-2`}
                  label={`${user.name} (${getListLengthBy(filterStore.filteredList, "sharedUser", user)})`}
                  value={user._id}
                  id={`resp-${user._id}`}
                  checked={filterStore.sharedUsers?.includes(user._id)}
                  type="checkbox"
                  name="filter-group-shared-users"
                  onChange={userToggleHandler}
                />
              );
            })}
          </Accordion.Body>
        </Accordion.Item>
      </Accordion>
      <Accordion className="py-2" defaultActiveKey="0">
        <Accordion.Item eventKey="0">
          <AccordionHeader>
            <span
              className={`${filterStore.categories?.length > 0 ? "text-info" : ""}`}
            >
              Категории
            </span>
          </AccordionHeader>
          <Accordion.Body>
            {sortedCategories.map((category) => {
              return (
                <Form.Check
                  key={category._id}
                  label={`${category.title} (${getListLengthBy(filterStore.filteredList, "category", category)})`}
                  className={`
                      ${filterStore.categories?.includes(category._id) ? "text-info" : ""}
                      ${
                        getListLengthBy(
                          filterStore.filteredList,
                          "category",
                          category,
                        ) === 0
                          ? "text-secondary"
                          : ""
                      } py-2`}
                  value={category._id}
                  id={`company-${category._id}`}
                  checked={filterStore.categories?.includes(category._id)}
                  type="checkbox"
                  name="filter-group-categories"
                  onChange={categoryToggleHandler}
                />
              );
            })}
          </Accordion.Body>
        </Accordion.Item>
      </Accordion>
    </FilterContainer>
  );
};

export default TicketTemplateFilter;
