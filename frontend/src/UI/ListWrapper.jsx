import { useState } from "react";

import { Outlet, useNavigation, Link, useNavigate } from "react-router";

import { BrowserView, MobileView } from "react-device-detect";

import {
  RiRefreshLine,
  RiArrowGoBackLine,
  RiAddFill,
  RiFilter3Line,
  RiSearchLine,
} from "react-icons/ri";

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
  onAddClick,
  hiddenAddButton,
  showAddButton = true,
  showBackButton = false,
  showRefreshButton = true,
  backRoute,
  defaultSearchValue = "",
  showSortAndCount = true,
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

  // Мобайл: поиск свёрнут в иконку-лупу в одном ряду с «Фильтр». Тап
  // разворачивает инпут, повторный тап — сворачивает и сбрасывает запрос
  // (инпут неконтролируемый и при монтировании пустой, поэтому свёрнутое
  // состояние всегда совпадает с «фильтр не применён»).
  const [searchOpen, setSearchOpen] = useState(false);

  const toggleSearch = () => {
    if (searchOpen) {
      filterStore.fullTextSearch("");
    }
    setSearchOpen((open) => !open);
  };

  return (
    <>
      <Card.Title className="mb-3 pb-2 border-bottom d-flex flex-wrap align-items-center gap-2">
        <h1 className="display-4 mb-0">{title()}</h1>
        <div className="d-flex gap-2 flex-shrink-0 ms-auto">
          {showBackButton && (
            <Button
              as={Link}
              to={backRoute || -1}
              size="lg"
              variant="outline-secondary"
              title="Назад"
              aria-label="Назад"
            >
              <RiArrowGoBackLine />
            </Button>
          )}
          {showRefreshButton && (
            <Button
              as={Link}
              replace
              to="."
              size="lg"
              variant="outline-secondary"
              title="Обновить"
              aria-label="Обновить список"
            >
              <RiRefreshLine />
            </Button>
          )}
          {showAddButton &&
            !hiddenAddButton &&
            (onAddClick ? (
              <Button
                onClick={onAddClick}
                size="lg"
                title="Добавить"
                aria-label="Добавить"
              >
                <RiAddFill />
              </Button>
            ) : (
              <Button
                as={Link}
                to={addRoute ? addRoute : "add"}
                onClick={offcanvas.setShow}
                size="lg"
                title="Добавить"
                aria-label="Добавить"
              >
                <RiAddFill />
              </Button>
            ))}
        </div>
      </Card.Title>
      {topContent}
      {customData ? customData() : ""}
      <MobileView>
        {filter && (
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
        )}
        <Row className="g-2 my-3 align-items-center">
          <Col xs="auto">
            <Button
              variant={searchOpen ? "secondary" : "outline-secondary"}
              onClick={toggleSearch}
              title="Поиск"
              aria-label="Поиск"
              aria-expanded={searchOpen}
            >
              <RiSearchLine />
            </Button>
          </Col>
          {filter && (
            <Col xs="auto">
              <Button
                variant="outline-secondary"
                onClick={filterOffcanvas.handleShow}
                title="Фильтр"
                aria-label="Фильтр"
              >
                <RiFilter3Line />
              </Button>
            </Col>
          )}
          {showSortAndCount && (
            <Col>
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
          )}
        </Row>
        {searchOpen && (
          <Row className="mb-3">
            <Col>
              <SearchBar
                onChange={searchHandler}
                defaultValue={defaultSearchValue}
                size="lg"
                autoFocus
              />
            </Col>
          </Row>
        )}
        {showSortAndCount && (
          <Row className="my-2">
            <Col className="fs-6 text-body-secondary">
              {`Найдено: ${filterStore.filteredList?.length || 0}`}
            </Col>
          </Row>
        )}
      </MobileView>
      <BrowserView>
        <Row className="my-3 g-2 align-items-center">
          {showSortAndCount && (
            <Col xs="auto" className="fs-6 text-body-secondary">
              {`Найдено: ${filterStore.filteredList?.length || 0}`}
            </Col>
          )}
          <Col className="px-4">
            <SearchBar
              onChange={searchHandler}
              defaultValue={defaultSearchValue}
            />
          </Col>
          {showSortAndCount && (
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
          )}
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
