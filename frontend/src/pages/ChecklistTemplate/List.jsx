import { useEffect } from "react";
import { useLocation } from "react-router";

import ListWrapper from "@/components/app/ListWrapper";

import List from "../../components/ChecklistTemplate/List";
import useChecklistTemplateStore from "../../store/lists/checklist-templates";

const ROUTE = "/tickets/checklist-templates";

const ChecklistTemplateListPage = () => {
  const location = useLocation();
  const store = useChecklistTemplateStore();

  useEffect(() => {
    store.applyFilter();
  }, [store.originalList]);

  // Фетчим только на самом списке: открытие шторки add/update — тоже навигация,
  // и рефетч в этот момент дёргал бы список под выезжающей шторкой
  useEffect(() => {
    if (location.pathname === ROUTE) {
      store.fetch();
    }
  }, [location.key]);

  return (
    <ListWrapper
      title={() => "Шаблоны чек-листов"}
      filterStore={store}
      addRoute={`${ROUTE}/add`}
      addLabel="Новый шаблон"
      emptyTitle="Шаблонов пока нет"
      emptyHint="Шаблон — готовый чек-лист с привязкой к категориям и компаниям. Подходящий приезжает в заявку сам."
    >
      <List items={store.filteredList} />
    </ListWrapper>
  );
};

export default ChecklistTemplateListPage;
