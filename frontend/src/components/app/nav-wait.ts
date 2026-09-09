import { useEffect } from "react";

/**
 * Управление линией ожидания (`app/NavProgress`) — счётчик ожидающих.
 *
 * Ждать умеет не только роутер: список берёт данные своим стором
 * (`store/lists/*`) уже после перехода, и для человека это то же ожидание
 * страницы. Источников много, индикатор один, поэтому нужен счётчик, а не
 * флаг: линия гаснет по последнему ожидающему, а не по первому.
 *
 * **Состояния React здесь намеренно нет.** Линию рисует CSS по признаку
 * `data-navigating` на корне документа, и перерисовывать ради неё дерево не
 * нужно ни одному компоненту. Первая редакция держала счётчик в zustand и
 * подписывала на него `layout/Root.jsx` — каждая загрузка списка выходила
 * двумя лишними перерисовками ВСЕЙ оболочки (на начало ожидания и на конец),
 * ровно в тот момент, когда страница и так занята разбором приехавших данных.
 * Переходы от этого дёргались.
 *
 * Пороги: линия появляется, если ожидание длится дольше 200 мс (быстрые
 * переходы не мигают), а по завершении доезжает до конца и гаснет — «done»
 * живёт ровно на время этой связки: доводка 200 мс + растворение 260 мс с
 * задержкой 200 мс (index.css), то есть 460 мс, плюс кадр запаса.
 */
const SHOW_DELAY = 200;
const DONE_DURATION = 470;

let waiting = 0;
let showTimer: ReturnType<typeof setTimeout> | undefined;
let doneTimer: ReturnType<typeof setTimeout> | undefined;

const flags = () => document.documentElement.dataset;

const show = () => {
  clearTimeout(doneTimer);
  doneTimer = undefined;
  if (showTimer !== undefined || flags().navigating === "pending") return;
  showTimer = setTimeout(() => {
    showTimer = undefined;
    flags().navigating = "pending";
  }, SHOW_DELAY);
};

const hide = () => {
  clearTimeout(showTimer);
  showTimer = undefined;
  if (flags().navigating !== "pending") {
    delete flags().navigating;
    return;
  }
  flags().navigating = "done";
  doneTimer = setTimeout(() => {
    doneTimer = undefined;
    if (flags().navigating === "done") delete flags().navigating;
  }, DONE_DURATION);
};

export const beginWait = () => {
  waiting += 1;
  if (waiting === 1) show();
};

export const endWait = () => {
  waiting = Math.max(0, waiting - 1);
  if (waiting === 0) hide();
};

/**
 * Пока `active`, горит линия ожидания. Вызывается вместо того, чтобы рисовать
 * спиннер: место ожидания — черта под баром оболочки, одна на всё приложение.
 */
export const useNavWait = (active: boolean) => {
  useEffect(() => {
    if (!active) return undefined;
    beginWait();
    return endWait;
  }, [active]);
};
