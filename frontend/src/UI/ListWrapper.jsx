import { Outlet, useNavigation, Link, useNavigate } from "react-router";

import { BrowserView, MobileView } from "react-device-detect";

import { RiRefreshLine, RiArrowGoBackLine } from "react-icons/ri";

import AddButton from "./AddButton";

import Transitions from "../animations/Transition";

import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Card from "react-bootstrap/Card";
import Button from "react-bootstrap/Button";
import Offcanvas from "react-bootstrap/Offcanvas";

import Spinner from "../animations/Spinner";
import AlertMessage from "./AlertMessage";
import SearchBar from "./SearchBar";

import useOffcanvasStore from "../store/offcanvas";
import useMobileFilterOffcanvasStore from "../store/mobile-filter-offcanvas";
import Select from "./Select";

const ListWrapper = ({
  title,
  filter,
  customData,
  topContent,
  filterStore,
  addRoute,
  hiddenAddButton,
  showAddButton = true,
  showBackButton = false,
  backRoute,
  defaultSearchValue = "",
  children,
}) => {
  const { state } = useNavigation();
  const navigate = useNavigate();

  const filterOffcanvas = useMobileFilterOffcanvasStore();

  const Filter = () => filter;

  const isLoading = filterStore.isLoading || filterStore.isSorting;

  const offcanvas = useOffcanvasStore();

  const searchHandler = (e) => {
    const query = e.target.value;
    filterStore.fullTextSearch(query);
  };

  return (
    <>
      <Card.Title className="mb-3 border-bottom">
        <h1 className="display-4">{title()}</h1>
      </Card.Title>
      {topContent}
      <BrowserView>
        <Row>
          <Col sm="auto">
            <Button as={Link} replace to="." size="lg" className="w-100 mb-3">
              <RiRefreshLine />
            </Button>
          </Col>
          {showBackButton && (
            <Col sm="auto">
              <Button
                as={Link}
                to={backRoute || -1}
                size="lg"
                className="w-100 mb-3"
                variant="secondary"
              >
                <RiArrowGoBackLine /> Назад
              </Button>
            </Col>
          )}
          {showAddButton && !hiddenAddButton && (
            <Col sm="auto">
              <AddButton
                onClick={offcanvas.setShow}
                content="Добавить"
                to={addRoute ? addRoute : "add"}
              />
            </Col>
          )}
          <Col>
            <SearchBar
              onChange={searchHandler}
              defaultValue={defaultSearchValue}
            />
          </Col>
        </Row>
      </BrowserView>
      <MobileView>
        <Row className="mb-3">
          <Col xs={showBackButton ? 4 : 6}>
            <Button as={Link} replace to="." size="lg" className="w-100">
              <RiRefreshLine /> Обновить
            </Button>
          </Col>
          {showBackButton && (
            <Col xs={4}>
              <Button
                as={Link}
                to={backRoute || -1}
                size="lg"
                className="w-100"
                variant="secondary"
              >
                <RiArrowGoBackLine /> Назад
              </Button>
            </Col>
          )}
          {showAddButton && !hiddenAddButton && (
            <Col xs={showBackButton ? 4 : 6}>
              <AddButton content="Добавить" to={addRoute ? addRoute : "add"} />
            </Col>
          )}
        </Row>
        <Row className="mb-3">
          <Col>
            <SearchBar
              onChange={searchHandler}
              defaultValue={defaultSearchValue}
            />
          </Col>
        </Row>
      </MobileView>
      {customData ? customData() : ""}
      <MobileView>
        <Offcanvas
          show={filterOffcanvas.isActive}
          onHide={filterOffcanvas.handleClose}
        >
          <Offcanvas.Header closeButton>
            <Offcanvas.Title>Фильтр</Offcanvas.Title>
          </Offcanvas.Header>
          <Offcanvas.Body>
            <Filter items={filterStore.originalList} />
          </Offcanvas.Body>
        </Offcanvas>
        <Row className="justify-content-between my-3  fs-5">
          <Col>{`Найдено: ${filterStore.filteredList?.length || 0}`}</Col>
        </Row>
        <Row className="justify-content-between align-items-center my-3 fs-6">
          <Col xs={7}>
            <Select
              placeholder="Сортировка"
              defaultValue={filterStore.sortBy}
              options={filterStore.sortingOptions}
              getOptionLabel={(option) => `${option.label}`}
              getOptionValue={(option) => option.label}
              onChange={(selectedItem) =>
                filterStore.handleSorting(selectedItem)
              }
            />
          </Col>
          <Col
            className="text-end text-success"
            onClick={filterOffcanvas.handleShow}
          >
            <u>Фильтр</u>
          </Col>
        </Row>
      </MobileView>
      <BrowserView>
        <Row className="justify-content-between my-3 fs-6 align-items-end">
          <Col>{`Найдено: ${filterStore.filteredList?.length || 0}`}</Col>
          <Col sm={3}>
            <Select
              placeholder="Сортировка"
              defaultValue={filterStore.sortBy}
              options={filterStore.sortingOptions}
              getOptionLabel={(option) => `${option.label}`}
              getOptionValue={(option) => option.label}
              onChange={(selectedItem) =>
                filterStore.handleSorting(selectedItem)
              }
            />
          </Col>
        </Row>
      </BrowserView>
      {(filterStore.filteredList?.length > 0 ||
        filterStore.originalList?.length > 0) && (
        <>
          {state === "idle" && !isLoading && (
            <Transitions>{children}</Transitions>
          )}
          {(state === "loading" || isLoading) && (
            <Transitions>
              <Spinner />
            </Transitions>
          )}
        </>
      )}
      {filterStore.filteredList?.length === 0 &&
        filterStore.originalList?.length === 0 &&
        !isLoading && <AlertMessage variant="light" message="Список пуст" />}
      <Offcanvas
        show={offcanvas.isActive}
        onHide={() => {
          navigate(-1);
          offcanvas.setClose();
        }}
        keyboard
        placement="bottom"
        className="h-100"
      >
        <Offcanvas.Header closeButton>
          <Offcanvas.Title></Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body>
          <Outlet />
        </Offcanvas.Body>
      </Offcanvas>
    </>
  );
};

export default ListWrapper;
