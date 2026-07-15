# TypeScript Guide

_Последнее обновление: 2026-07-16 (ред. 2 — включён фронт-гейт типизации
(`pnpm typecheck`, зелёный), TS сведён к 6.0.x, внедрён `satisfies`). Свод правил
по TypeScript для этого репозитория: как писать новые `.ts`/`.tsx`, чтобы код был
единообразен и типобезопасен. Документ — снимок сложившихся в коде конвенций плюс
план на пробелы; при расхождении с кодом ориентируйтесь на код и обновляйте файл._

**Эталон:** [TypeScript Best Practices for Production Code in 2026][ref] — берём
его 15 практик за ориентир, но адаптируем к реальности репозитория: бэкенд
работает на **нативном type-stripping** Node (без сборки), фронтенд — на
**react-router data router** и в процессе миграции, а Zod в проекте нет
(валидация — `express-validator` на бэкенде, граничные type-guard'ы на фронте).
UI-конвенции — в соседнем [`ux-ui-guide.md`](./ux-ui-guide.md); тут только типы.

[ref]: https://dev.to/_d7eb1c1703182e3ce1782/typescript-best-practices-for-production-code-in-2026-lb0

---

## Карта типизации репозитория

Две независимые истории миграции — у бэкенда и фронтенда разные раннеры,
конфиги и статус. Не переносите приёмы вслепую между ними.

**Backend** (`backend/`, CommonJS, Express 5, Mongoose 8):

- Раннер — **нативный type-stripping Node 22** (`node app.js`, без tsx/ts-node и
  без шага сборки). `.ts` и `.js` сосуществуют. Отсюда жёсткое правило:
  **только стираемый (erasable) синтаксис** — `tsconfig` включает
  `erasableSyntaxOnly: true` (см. раздел «Стираемый синтаксис»).
- `tsconfig.json` — **только для проверки типов**: `noEmit`, `allowJs`,
  `checkJs: false`, `strict`. `include` пока сужен до `models/**/*.ts` +
  `types/**/*.ts`; расширяем по мере конвертации. Гейт есть:
  `pnpm typecheck` (`tsc --noEmit`) — **сейчас проходит чисто**. TypeScript
  **6.0.3**.
- Типы моделей живут в **зеркальной директории `backend/types/`** (`types/user.ts`
  → `IUser`, `types/inventory/deviceType.ts` → `IDeviceType`, общие встроенные
  формы — `types/_shared.ts`). Модели (`models/**`) пока **все `.js`** — интерфейсы
  ещё не вплетены в схемы. Подробности и статус миграции — в памяти проекта
  (`ts-migration`).

**Frontend** (`frontend/`, React 19, react-router 7, Vite 6):

- Сборка — **esbuild через Vite**, он стирает типы не проверяя их. Поэтому
  проверка типов — отдельным гейтом: **`pnpm typecheck` (`tsc --noEmit`)**,
  сейчас зелёный (как включён — см. «Гейт типизации на фронте»). eslint работает
  с `project: false` (**без type-aware правил**) — за типы отвечает `tsc`, не он.
  TypeScript **6.0.3** (сведён с бэкендом).
- TypeScript пока только в: `components/app/*` (примитивы дизайн-системы),
  `lib/utils.ts`, `types/*` (доменные типы), `store/authed-user.ts`,
  `components/ui/*` (генерённые shadcn).
  Страницы (`pages/**`,
  ~390 `.jsx`), сторы (`store/**`, `.js`) и большинство компонентов — ещё
  легаси JS/JSX. Новый код в мигрируемых областях пишем на TS.
- `strict: true`, `isolatedModules: true`, `moduleResolution: "bundler"`,
  `types: []` (см. раздел про гейт), алиас `@/* → ./src/*`.

**Версии сведены:** обе стороны на TS **6.0.x** (фронт поднят 5.8→6.0.3, `baseUrl`
убран как deprecated в TS 6). Caveat: `typescript-eslint@8.33` декларирует peer
`typescript <5.9` — линт работает, но при чистой переустановке в контейнере
стоит поднять и `typescript-eslint` до версии с поддержкой TS 6.

---

## Практики эталона → статус у нас

| # | Практика эталона | Статус | Где смотреть / что делать |
|---|---|---|---|
| 1 | `strict` всегда | ✅ обе стороны + гейт | фронт-гейт включён (`pnpm typecheck`); опц. `noUncheckedIndexedAccess` |
| 2 | `unknown` вместо `any` | ✅ соблюдаем (0 `any` в рукописном) | `entity-permissions.ts`, `ListRow` |
| 3 | Дискриминированные юнионы для состояний | ⚠️ пробел | `FormWrapper` data — «мешок опций», см. ниже |
| 4 | `type` vs `interface` | ✅ де-факто раскол | backend `interface I*`, frontend `type` |
| 5 | Утилитные типы (`Omit`/`Pick`/`Partial`) | ⚠️ не используем | DTO на бэкенде выводить из `IXxx` |
| 6 | Типизировать ответы API | ⚠️ главный фронт-пробел | данные роутера (loader/action/fetcher) |
| 7 | `as const` для литералов | ✅ соблюдаем | `ThemeSegment`, `AlertMessage` |
| 8 | Дженерики с ограничениями | ✅ где нужно | `PillPanel` `getKey`/`getLabel` |
| 9 | Template literal types | ⚪️ по необходимости | пока не требуется |
| 10 | Не врать компилятору кастами | ✅ подчищено | `PillPanel` — type-guard; остаётся `as` роутера |
| 11 | Mapped types | ⚪️ по необходимости | `FormErrors<T>` при валидации форм |
| 12 | Типизировать обработку ошибок | ⚠️ на будущее | `catch (e: unknown)` при конвертации контроллеров |
| 13 | Типы в выделенных файлах | ✅ бэкенд (`types/`) | фронт: пропсы co-located, домен — общий модуль |
| 14 | `satisfies` для объектов-литералов | ✅ внедрено | `VARIANT_MAP` (AlertMessage), `THEME_OPTIONS` |
| 15 | `isolatedModules` + `import type` | ✅ соблюдаем | codify; рассмотреть `verbatimModuleSyntax` |

Ниже — по каждому пункту, что это значит именно в нашем коде.

---

## Конфигурация (`tsconfig`)

**`strict: true` — не трогаем.** Он уже включён на обеих сторонах и включает
`strictNullChecks`, `noImplicitAny`, `strictFunctionTypes`, `strictBindCallApply`
(эталон #1).

**Рекомендуется добавить `noUncheckedIndexedAccess`** (эталон #1): тогда
`array[0]` даёт `T | undefined`, а не `T`. Это ловит реальные места, где мы
сейчас молча полагаемся на наличие элемента — `parts[0]` в
`components/app/monogram.ts`, `digits[0]` в `PhoneInput.tsx`, деструктуризация
`[entry]` в колбэке `IntersectionObserver` (`ListWrapper.tsx`). Включать
**осознанно**: он потребует явных проверок/`?.` в этих точках.

**`exactOptionalPropertyTypes` — пока НЕ включаем.** Эталон его советует, но наши
интерфейсы моделей насквозь `?`-опциональны (Mongoose), и различие «нет ключа»
vs «ключ со значением `undefined`» дало бы много шума без пользы. Кандидат на
далёкое будущее.

**Backend, `erasableSyntaxOnly: true` — оставляем.** Это следствие нативного
type-stripping (см. ниже). `baseUrl` на бэкенде уже убран (в TS 6 он deprecated)
— `paths` резолвятся относительно `tsconfig`.

**Frontend** (сделано при включении гейта):

- `baseUrl` убран (в TS 6 deprecated) — резолвинг только через `paths`.
- Заведён скрипт `"typecheck": "tsc --noEmit"`; `types: []` (см. раздел про гейт).
- На будущее — **`verbatimModuleSyntax: true`**, чтобы *принудительно* требовать
  `import type` (эталон #15), строже текущего `isolatedModules`; и опционально
  `noUncheckedIndexedAccess`.

---

## Стираемый синтаксис (backend, обязательно)

Node запускает `.ts` **стирая типы**, а не компилируя их. Поэтому весь
синтаксис, у которого есть **рантайм-семантика**, запрещён — `tsconfig` держит
`erasableSyntaxOnly: true` как страховку. **Нельзя:**

- `enum` и `const enum` → вместо них **string-literal юнионы** (см. ниже);
- рантайм-`namespace` (модульный — можно только как тип);
- **parameter properties** (`constructor(private x: T)`) → объявляйте поля явно;
- `import x = require()` / `export =` → только ESM-совместимый `import`/`export`.

Это же — хорошая гигиена и на фронте (там `isolatedModules` ловит часть того же).

---

## `any` → `unknown` (эталон #2) — соблюдаем, кодифицируем

В рукописном TS **нет ни одного `any`** — это стандарт, не удача. Для данных, чью
форму мы на границе не знаем, берём `unknown` и сужаем:

```ts
// components/app/entity-permissions.ts — «неизвестный» createdBy сравниваем
// строкой, не притворяясь, что знаем его тип
item: { createdBy?: unknown },
// ...
item.createdBy != null && String(item.createdBy) === userId
```

```ts
// components/app/ListWrapper.tsx — списки приходят «сырыми», типизируем как unknown[]
filteredList?: unknown[];
originalList?: unknown[];
```

Правило: `any` — только как осознанный аварийный люк с
`// eslint-disable-next-line @typescript-eslint/no-explicit-any` и комментарием
«почему». По умолчанию — `unknown` + сужение (type guard) или явный интерфейс.

---

## `type` vs `interface` (эталон #4) — наш де-факто раскол

Мы уже следуем «прагматичному правилу» эталона, просто зафиксируем его:

- **`interface IXxx` — для форм документов моделей на бэкенде.** Объектные формы,
  которые дальше вплетаются в `Schema<IUser>`/`model<IUser>`; префикс `I`;
  один файл на модель в `backend/types/`.

  ```ts
  // backend/types/inventory/deviceType.ts
  import type { Types } from "mongoose";

  export interface IDeviceType {
    name: string;
    isActive: boolean;
    configurationIds?: Types.ObjectId[];
    createdBy?: Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
  }
  ```

- **`type` — для всего остального** (фронтенд-пропсы, юнионы, производные типы). В
  рукописном фронте **0 `interface` и 15 `type`** — единый стиль.

  ```ts
  // components/app/ListRow.tsx
  type ListRowProps = {
    item: { _id: string; title?: string; /* … */ };
    monogram?: ReactNode;
    detailTo?: string;
  };
  ```

Не смешивайте: пропсы React — всегда `type`; форму Mongoose-документа — всегда
`interface I*`.

---

## String-literal юнионы вместо `enum`

Обязательно на бэкенде (стираемый синтаксис), рекомендуется везде. Enum'ы модели
превращаем в юнион литералов:

```ts
// backend/types/user.ts
export type WorkStatusCode =
  | "office" | "remote" | "trip" | "lunch" | "vacation" | "sick" | "unset";

// backend/types/_shared.ts — встроенный статус
status?: "idle" | "pending" | "ready" | "error";
```

Значения юниона должны совпадать с **enum схемы Mongoose** (источник правды —
модель). На фронте тот же приём для конфиг-значений (см. `WorkStatusCode`,
`ThemeSegment`).

---

## `as const` + `satisfies` для конфиг-объектов (эталон #7, #14)

`as const` уже используется правильно — фиксирует литеральные типы и даёт
выводить из них юнион:

```ts
// components/app/ThemeSegment.tsx
export const THEME_OPTIONS = [
  { value: "light", label: "Светлая", Icon: RiSunLine },
  { value: "dark", label: "Тёмная", Icon: RiMoonLine },
  { value: "system", label: "Системная", Icon: RiComputerLine },
] as const;
```

```ts
// components/app/AlertMessage.tsx — производный юнион из ключей карты
const VARIANT_MAP = { danger: "destructive", success: "success", /* … */ } as const;
type BootstrapVariant = keyof typeof VARIANT_MAP;
```

**`satisfies` (эталон #14) — внедрено.** `as const` фиксирует литералы, но **не
проверяет форму значений**. Где у карты есть контракт — добавляем `satisfies`:
ловит опечатку в значении, сохраняя узкие ключи.

```ts
// components/app/AlertMessage.tsx
type AlertVariant =
  | "default" | "destructive" | "success" | "warning" | "info" | "light";
const VARIANT_MAP = {
  danger: "destructive",
  success: "success",
  // …
} as const satisfies Record<string, AlertVariant>; // узкие ключи + валидация
```

Так же оформлен `THEME_OPTIONS` (`ThemeSegment.tsx`:
`… as const satisfies readonly { value: ThemeValue; … }[]`). Дальнейшие
кандидаты — конфиги меню (`layout/Navigation/menu.js` при конвертации), таблицы
«статус → вариант».

---

## Дискриминированные юнионы для состояний (эталон #3)

Наш `FormWrapper` сейчас типизирует результат экшена «мешком опций» — это ровно
анти-паттерн эталона:

```ts
// components/app/FormWrapper.tsx — сегодня
const data = useActionData() as { message?: string; error?: boolean } | undefined;
// приходится городить: data && data.message && data.error, data && !data.error …
```

Для новых экшенов/состояний моделируйте результат **дискриминированным юнионом** —
тогда ветки сужаются автоматически, без флаговой арифметики:

```ts
type ActionResult =
  | { ok: true; message?: string }
  | { ok: false; message: string };

const result = useActionData() as ActionResult | undefined;
if (result && !result.ok) {
  // здесь result.message: string — гарантированно есть
}
```

То же для UI-состояний загрузки: `{ status: "loading" } | { status: "success";
data: T } | { status: "error"; error: string }`, а не три необязательных поля.

---

## Типобезопасные данные роутера (эталон #6) — главный фронт-пробел

react-router возвращает данные loader/action/fetcher как **`any`/`unknown`**, и
сейчас мы затыкаем это `as`-кастами и обращениями «наугад»:

```ts
// FormWrapper.tsx — fetcher.data здесь фактически any:
if (fetcher.state === "idle" && fetcher.data && !fetcher.data.error) { … }
const data = useActionData() as { message?: string; error?: boolean } | undefined;
```

Правило для нового кода:

- **Объявляйте тип возврата loader/action** и приводите ровно к нему один раз, у
  границы: `const data = useActionData() as ActionResult | undefined` (лучше —
  дискриминированный юнион, см. выше). Не разбрасывайте `as` по месту
  использования.
- Где данные приходят из `fetch`/внешнего API — оборачивайте в **типизированный
  помощник** и **проверяйте на границе type-guard'ом** (Zod в проекте нет):

  ```ts
  async function fetchJson<T>(url: string): Promise<T> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
    return res.json() as Promise<T>;
  }
  ```

- Значения из `FormData` — всегда `string | File | null`; приводите явно
  (`String(fd.get("id"))`, `fd.get("intent") === "delete"`), а не притворяйтесь,
  что там уже нужный тип.

Когда фронт дорастёт до типизированного слоя данных — это первое место, куда
вкладываться.

---

## Утилитные типы для DTO (эталон #5)

Не дублируйте формы — **выводите** их из `IXxx`. Особенно на бэкенде при
появлении DTO создания/обновления/публичного ответа:

```ts
import type { IUser } from "@/types/user";

type CreateUserDto = Omit<IUser, "createdAt" | "updatedAt" | "createdBy">;
type UpdateUserDto = Partial<Pick<IUser, "firstName" | "lastName" | "position">>;
type PublicUser    = Omit<IUser, "password" | "resetToken" | "verifyToken">;
```

Вопрос перед новым типом: «Могу ли я вывести его из существующего?» — обычно да
(`Pick`, `Omit`, `Partial`, `Record`, `ReturnType`, `Awaited`, `Parameters`).

---

## Не врать компилятору кастами (эталон #10)

`as` не проверяет — он приказывает. Используем **type guard**, а `as` — только
когда наша логика заведомо шире вывода, и с комментарием «почему».

Точечный долг в коде — `components/app/PillPanel.tsx`: `unknown` из
`Record<string, unknown>` приводится к `ReactNode` четырежды, включая рендер
произвольного объекта:

```ts
const defaultLabel = (item: PillItem): ReactNode =>
  (item?.title as ReactNode) ?? (item?.alias as ReactNode) ??
  (item?.name  as ReactNode) ?? (item as ReactNode);   // ← может отрендерить объект
```

Правильнее — сузить по типу перед рендером:

```ts
const asText = (v: unknown): string | undefined =>
  typeof v === "string" || typeof v === "number" ? String(v) : undefined;
const defaultLabel = (item: PillItem): ReactNode =>
  asText(item.title) ?? asText(item.alias) ?? asText(item.name) ?? "—";
```

Единственное законное исключение — когда вывод TS не может совпасть с
проверенной логикой (например, после `.filter(Boolean)`): тогда `as` + коммент.

---

## Обработка ошибок (эталон #12)

`catch` даёт `unknown` — не трогайте `.message` вслепую. Правило пригодится при
конвертации контроллеров бэкенда в `.ts`:

```ts
try {
  await saveUser(data);
} catch (e) {
  if (e instanceof Error) logger.error(e.message);
  else logger.error("Unknown error", e);
}
```

Для ожидаемых сбоев (валидация, «не найдено») уместен `Result`-паттерн
(`{ ok: true; value: T } | { ok: false; error: E }`) вместо throw — но не
насаждаем его повсеместно, только где ветка ошибки — часть нормального потока.

---

## Импорты только типов (эталон #15) — соблюдаем

Под `isolatedModules` (фронт) и нативным стриппингом (бэк) типы обязаны
импортироваться как типы — иначе рантайм попытается импортировать несуществующий
рантайм-символ. Мы это делаем; кодифицируем два стиля:

```ts
// чистый тип-модуль — import type целиком:
import type { ReactNode } from "react";
import type { Types } from "mongoose";

// смешанный импорт — inline type перед именами-типами:
import { useState, type ReactNode } from "react";
import { useEffect, useRef, type ChangeEvent } from "react";
```

**Единый стиль для событий/типов React — именованный импорт, не `React.Xxx`.**
Оба места сведены к `import { …, type ChangeEvent } from "react"` (`ListWrapper`,
`PhoneInput`). Новый код — так же: `ChangeEvent`, `FormEvent`, `CSSProperties`,
`ComponentProps` … через именованный type-импорт, `React.` не пишем.

---

## React-компоненты: форма файла

Сложившийся и обязательный для нового кода шаблон (см. `components/app/Field.tsx`,
`ListRow.tsx`, `FormSheet.tsx`):

- **Стрелочная функция + `export default`** в конце файла. **Никакого
  `React.FC`** (0 в коде) — он тянет неявные `children` и мешает дженерикам.
- **Пропсы — `type`.** Мелкий компонент — инлайн-литерал типа прямо в сигнатуре;
  крупный (много пропсов, переиспользуемый) — именованный `type XProps`.
- **`ReactNode`** — для `children` и всего, что рендерится; необязательные
  колбэки — `(value: string) => void`; значения по умолчанию — в деструктуризации.
- **JSDoc `/** */` на отдельных пропсах**, если назначение неочевидно (как в
  `ListRow`, `SwitchField`).
- Дженерики хуков указываем явно: `useRef<HTMLDivElement | null>(null)`,
  `useState<number | null>(collapsedMaxHeight)`.

```tsx
// мелкий — инлайн-литерал
const Field = ({
  label, htmlFor, required = false, hint, className, children,
}: {
  label: ReactNode;
  htmlFor?: string;
  required?: boolean;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) => { /* … */ };
export default Field;

// крупный/переиспользуемый — именованный тип
type ListRowProps = { /* … */ };
const ListRow = ({ … }: ListRowProps) => { /* … */ };
export default ListRow;
```

`components/ui/*` — **генерённые** shadcn-файлы; их руками не переписываем и под
эти правила не подгоняем (расхождения чинятся токенами/точечно — см. ux-ui-guide).

---

## Организация типов (эталон #13)

- **Backend — зеркало `types/`.** Один файл на модель, имя = имя модели без
  суффикса, `export interface IXxx`. Общие встроенные формы — `types/_shared.ts`
  (`IAttachment`, `IWorkSchedule`, `IDaySchedule`). Рефы — `Types.ObjectId`,
  `timestamps` → `createdAt/updatedAt: Date`. Не тащите в списочные проекции
  populate-имена, если они там не нужны.
- **Frontend — двухуровнево** (важное различие эталона #13):
  - **Пропсы и UI-внутренние формы — co-located** (инлайн или `type XProps`
    рядом с компонентом): `ListRowProps`, `FilterStore`, `ChipSelectOption` …
    Это публичный API компонента — в общую директорию **не** выносим (разорвёт
    связь и расплодит импорты). Так же co-locate'ит и сам эталон.
  - **Доменные типы — в `src/types/`** (зеркалит `backend/types/`): модель
    пользователя, заявки, справочника и т.п. Заведено: `src/types/user.ts` →
    `AuthedUser` (читается хуком `useAuthedUser` из `store/authed-user.ts`).
    Новый доменный тип, общий по смыслу для приложения, кладём сюда, а не
    инлайн в компонент.

---

## Типизируйте общий контекст и сторы

Найденный при анализе пример, почему это важно. `store/authed-user-context.js` —
**JS с частичным дефолтом**:

```js
export const defaultAuthedUser = { permissions: {}, workStatus: { … } };
export const AuthedUserContext = createContext(defaultAuthedUser);
```

TS выводит тип контекста из этого дефолта — **без `_id`, без флагов прав**.
Поэтому потребитель ломается на выводе типа:

```ts
// components/app/ListRow.tsx:65
const { _id: userId, permissions } = useContext(AuthedUserContext);
//        ^^^ Property '_id' does not exist on the inferred context type
```

Решение — доменный тип **`AuthedUser` в `src/types/user.ts`**, а типобезопасный
доступ — **граничным хуком** `store/authed-user.ts` (стор остаётся `.js` до
поэтапной миграции сторов):

```ts
// src/types/user.ts — доменная модель
export type AuthedUser = {
  _id: string;
  permissions: Record<string, boolean>;
  // … остальные читаемые поля
};

// src/store/authed-user.ts — граница
export function useAuthedUser(): AuthedUser {
  // as unknown as: значение из JS-стора; реальный объект (провайдер в Root)
  // полнее частичного дефолта — приводим осознанно, до миграции стора на TS
  return useContext(AuthedUserContext) as unknown as AuthedUser;
}
```

Потребители на TS зовут `useAuthedUser()` вместо `useContext(AuthedUserContext)`
(см. `ListRow.tsx`). Когда стор мигрирует на TS, тип переедет в него, а хук
станет тонким. Правило: общий контекст/стор, читаемый из TS, получает **явный
тип** — временно граничным хуком, в идеале самим стором.

---

## Гейт типизации на фронте (включён)

Фронт-гейт — **`pnpm typecheck` (`tsc --noEmit`)**, зелёный, TS 6.0.3. Как он
включён (и почему раньше `tsc` «зеленил» вхолостую):

1. **`compilerOptions.types: []`.** TS авто-включал все папки `node_modules/@types`,
   среди которых — **пустые orphan-директории `@types/raf` и `@types/pako`**
   (pnpm-артефакт, их никто не импортирует). Нерезолвимый `types`-энтри даёт
   `TS2688`, а **`TS2688` короткозамыкает полную проверку программы** — поэтому
   наивный `tsc` показывал лишь 2 «ошибки» и МОЛЧА не проверял приложение.
   `types: []` снимает авто-включение (React резолвится через импорты, не через
   глобальный `types`) → честный полный проход. **Каталог `types` держим пустым**
   — не возвращайте авто-включение `@types`, вернётся orphan-шум и маскировка.
2. **Дедуп `@types/react`** (`pnpm.overrides` → `19.1.6`). Ошибки ref-типов в
   генерённых `components/ui` (`button`/`badge`, `RefAttributes<HTMLElement>`)
   были **не в коде, а в зависимостях**: radix-ui собран против
   `@types/react@19.1.6`, а верх дерева тянул `19.1.5` — два `@types/react` в
   React-19-приложении рассинхронят ref-типы. Один override — генерённые файлы
   чисты, руками их править не пришлось (это и есть «судьба `components/ui`»:
   чиним дедупом зависимостей, а не патчим генерённое).
3. **Типизация `AuthedUserContext`** граничным хуком (см. раздел выше) — убрала
   единственную реальную ошибку в нашем коде.

Держим гейт зелёным: новый `.ts`/`.tsx` не должен его ронять — `pnpm typecheck`
перед мерджем (и на бэке — тоже).

---

## Верификация

- **Backend:** `pnpm typecheck` (должен оставаться зелёным). Модели вплетаем в
  схемы (`Schema<IXxx>`) по мере конвертации `.js`→`.ts`, в порядке зависимостей
  utils→models→controllers→routes.
- **Frontend:** `pnpm typecheck` (`tsc --noEmit`) — гейт включён и зелёный, держим
  таким. eslint — `pnpm lint` (`--max-warnings=0`); учтите, что на легаси-`.jsx`
  он сейчас красен своим долгом (`no-prototype-builtins`, отсутствующий плагин
  `react-hooks`) — на новый TS это не влияет, но зелёным `pnpm lint` станет лишь
  после разбора легаси-долга.
- **Никогда** не «чиним» типы, отключая проверку (`@ts-ignore`, `as any`,
  расширение `any`). В рукописном коде их сейчас 0 — держим планку.

---

## Чек-лист перед мерджем TS

- [ ] Нет `any` (кроме аварийного люка с `eslint-disable` + причиной); внешние
      данные — `unknown` + сужение.
- [ ] Нет `enum`/`namespace`/parameter properties/`import =` (стираемый
      синтаксис); enum'ы — string-literal юнионы.
- [ ] Backend: форма документа — `interface IXxx` в `types/`; рефы —
      `Types.ObjectId`; `import type { Types } from "mongoose"`.
- [ ] Frontend: пропсы — `type` (инлайн для мелких, `type XProps` для крупных);
      компонент — стрелочная функция + `export default`, **без `React.FC`**.
- [ ] `import type` для типов; события React — именованный импорт
      (`type ChangeEvent`), **не `React.ChangeEvent`**.
- [ ] Конфиг-карты — `as const` (+ `satisfies Record<…>` там, где есть контракт).
- [ ] Состояния/результаты — дискриминированный юнион, а не «мешок»
      необязательных полей.
- [ ] Данные роутера/`fetch` типизированы у границы (тип возврата loader/action,
      один `as` на границе или type-guard), а не касты «наугад» по месту.
- [ ] DTO выведены из `IXxx` утилитными типами, а не продублированы.
- [ ] `catch (e)` обрабатывает `unknown` (`e instanceof Error`), а не читает
      `.message` вслепую.
- [ ] Общий контекст/стор, читаемый из TS, имеет явный тип (не выводится из
      частичного дефолта).
- [ ] Касты `as` — только с обоснованием; предпочтение — type guard.
- [ ] `pnpm typecheck` зелёный на обеих сторонах (гейт включён и на фронте, и на
      бэке) — новый код его не роняет.
