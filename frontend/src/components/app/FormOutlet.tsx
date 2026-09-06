import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  resolvePath,
  useMatches,
  useNavigate,
  useOutlet,
  useResolvedPath,
  type NavigateOptions,
  type To,
} from "react-router";

import FormSheet, { type SheetSize } from "@/components/app/FormSheet";

/**
 * Единственный хозяин шторки для форм-маршрутов.
 *
 * Форма добавления/правки — вложенный маршрут списка, карточки или главной, и
 * шторку для неё рисует тот, кто рендерит `<FormOutlet />` вместо `<Outlet />`.
 * Открыта ли шторка, решает сам маршрут: у формы в `handle.sheet` лежит её
 * ширина, и пока такой маршрут совпадает с адресом, шторка открыта. Никакого
 * общего флага «шторка открыта» больше нет — раньше его выставляли и ссылки, и
 * эффект по хвосту пути, а каждая строка списка перерисовывалась на каждое
 * открытие и закрытие.
 *
 * Шторка открывается ПО ГОТОВНОСТИ: роутер рендерит новый маршрут только после
 * его загрузчика, поэтому `useOutlet()` меняется с null на форму в том же
 * коммите, в котором она впервые нарисована, — шторка въезжает один раз и уже с
 * готовой формой. Заглушек и доигрывания высоты «по приезде» нет.
 *
 * Закрытие — сначала анимация, потом переход. Форма ещё смонтирована, пока
 * шторка уезжает; переход делает `onExitComplete` (у radix это
 * onCloseAutoFocus, он срабатывает после размонтирования содержимого).
 * Куда уходить, форма говорит через `useFormSheet().close(to?)`:
 *   • `close()` — как «Отмена» и крестик: назад по истории, если она есть
 *     (форму открыли в приложении), иначе на адрес хозяина с replace (прямая
 *     ссылка на форму);
 *   • `close("..", { replace: true })` — как успешный сабмит: адрес хозяина,
 *     запись формы не остаётся в истории;
 *   • `close("/tickets/42", { replace: true })` — карточка созданной сущности.
 * Относительные адреса форма разрешает у себя (`..` — родительский маршрут),
 * хозяин получает уже абсолютные: к моменту перехода формы в дереве нет.
 *
 * «Назад» браузером при открытой шторке снимает маршрут раньше анимации —
 * шторка доигрывает уход пустой, на замороженной высоте (см. FormSheet).
 */

export type SheetHandle = { size?: SheetSize; title?: string };

/** `handle` маршрута формы: `{ ...SHEET_MD, can: {...} }` при гейте прав. */
export const sheetHandle = (size: SheetSize, title?: string) => ({
  sheet: { size, title } as SheetHandle,
});
export const SHEET_MD = sheetHandle("md");
export const SHEET_LG = sheetHandle("lg");
export const SHEET_XL = sheetHandle("xl");

/** Шторка самого глубокого совпавшего маршрута — формы всегда листья. */
export function useSheetHandle(): SheetHandle | undefined {
  const matches = useMatches();
  const last = matches[matches.length - 1];
  return (last?.handle as { sheet?: SheetHandle } | undefined)?.sheet;
}

/** Открыта ли сейчас шторка формы — для пауз фонового обновления и т. п. */
export const useSheetOpen = () => useSheetHandle() !== undefined;

type CloseOptions = Pick<NavigateOptions, "replace">;

type FormSheetApi = {
  close: (to?: To, options?: CloseOptions) => void;
  /** Шторка уже уезжает — повторные нажатия можно игнорировать. */
  closing: boolean;
};

const FormSheetContext = createContext<FormSheetApi | null>(null);

const historyIndex = () =>
  (window.history.state as { idx?: number } | null)?.idx ?? 0;

const FormOutlet = () => {
  const outlet = useOutlet();
  const sheet = useSheetHandle();
  const navigate = useNavigate();

  const routeOpen = outlet !== null && sheet !== undefined;
  const [closing, setClosing] = useState(false);
  const pending = useRef<{ to?: To; options?: CloseOptions } | null>(null);
  const routeOpenRef = useRef(routeOpen);
  routeOpenRef.current = routeOpen;
  // Ширина и заголовок нужны и пока шторка уезжает, а маршрута уже нет
  const lastSheet = useRef(sheet);
  if (sheet) lastSheet.current = sheet;

  // Маршрут ушёл (наш переход, «назад» браузером, ссылка в другой раздел) —
  // сбрасываемся здесь и только здесь: сбрось `closing` раньше, между
  // переходом и его коммитом, и шторка мигнула бы открытой.
  useEffect(() => {
    if (!routeOpen) {
      setClosing(false);
      pending.current = null;
    }
  }, [routeOpen]);

  const close = useCallback((to?: To, options?: CloseOptions) => {
    pending.current = { to, options };
    setClosing(true);
  }, []);

  const finishClose = () => {
    const request = pending.current;
    pending.current = null;
    // Уже ушли (например, «назад» браузером во время анимации) — ничего не делаем
    if (!request || !routeOpenRef.current) return;
    if (request.to !== undefined) {
      navigate(request.to, request.options);
    } else if (historyIndex() > 0) {
      navigate(-1);
    } else {
      navigate(".", { replace: true });
    }
  };

  const api = useMemo(() => ({ close, closing }), [close, closing]);

  // Вложенный маршрут без шторки (не форма) рисуется как обычный Outlet
  if (outlet !== null && sheet === undefined) return outlet;

  const shown = sheet ?? lastSheet.current;

  return (
    <FormSheet
      open={routeOpen && !closing}
      size={shown?.size}
      title={shown?.title}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      onExitComplete={finishClose}
    >
      <FormSheetContext.Provider value={api}>{outlet}</FormSheetContext.Provider>
    </FormSheet>
  );
};

export default FormOutlet;

/**
 * Закрытие шторки из формы. Вне шторки (форма базы знаний в основной панели)
 * ведёт себя как обычный переход, чтобы одна и та же форма работала и там.
 */
export function useFormSheet(): FormSheetApi {
  const context = useContext(FormSheetContext);
  const navigate = useNavigate();
  const here = useResolvedPath(".");
  const parent = useResolvedPath("..");

  const close = useCallback(
    (to?: To, options?: CloseOptions) => {
      if (!context) {
        if (to === undefined) navigate(-1);
        else navigate(to, options);
        return;
      }
      let target: To | undefined = to;
      if (to === "..") target = parent;
      else if (to === ".") target = here;
      else if (typeof to === "string" && !to.startsWith("/")) {
        target = resolvePath(to, here.pathname);
      }
      context.close(target, options);
    },
    [context, navigate, here, parent],
  );

  return { close, closing: context?.closing ?? false };
}
