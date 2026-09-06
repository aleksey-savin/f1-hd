/**
 * Линия ожидания перехода — на нижней границе бара оболочки (макет «Индикатор
 * перехода», вариант B: линия стоит на черте, под которой появится страница,
 * и стоит там одинаково на десктопе, в браузере телефона и в PWA).
 *
 * Появляется, когда переход длится дольше 200 мс: признак `data-navigating`
 * на корне документа ставит `layout/Root.jsx` по `useNavigation` — «pending»
 * (линия ползёт) и «done» (доезжает до конца и гаснет). Геометрия — классами
 * здесь, движение — в index.css: у keyframes утилиты нет. В покое линия
 * невидима и места не занимает. Хозяева — оба заголовка `layout/Navbar.jsx`.
 */
const NavProgress = () => (
  <div
    aria-hidden
    className="nav-progress pointer-events-none absolute inset-x-0 -bottom-px h-0.5 w-0 bg-primary opacity-0"
  />
);

export default NavProgress;
