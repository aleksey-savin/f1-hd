import { useEffect, useRef, useState } from "react";
import { Link, useFetcher } from "react-router";
import { isMobile } from "react-device-detect";
import {
  RiComputerLine,
  RiRefreshLine,
  RiSearchLine,
  RiUserAddLine,
  RiUserUnfollowLine,
} from "react-icons/ri";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Field from "@/components/app/Field";
import AlertMessage from "@/components/app/AlertMessage";
import Spinner from "@/components/app/Spinner";
import { monogramFor } from "@/components/app/monogram";
import { InsideOverlayContext } from "@/components/app/overlay-context";
import { cn } from "@/lib/utils";

import Select from "../../UI/Select";
import { getLocalStorageData } from "../../util/auth";
import { plural } from "../../util/plural";
import {
  businessDaysAgo,
  formatDate,
  formatDayMonth,
  formatTime,
} from "../../util/format-date";

// Лог активности компании (макет v2). Главный вопрос журнала — «за каким
// компьютером сидит пользователь», поэтому иерархия такая: поиск сверху →
// карта «Кто за каким компьютером» (по последнему входу каждой AD-учётки,
// агрегат-эндпоинт) → журнал входов. Связь «учётка ↔ пользователь» управляется
// прямо в строке карты (одно действие на учётку — связь живёт на GUID);
// в журнале кнопок нет. Поиск фильтрует карту мгновенно на клиенте, журнал —
// серверно с дебаунсом.
const API = import.meta.env.VITE_API_ADDRESS;
const PAGE_SIZE = 20;

const adName = (entry) =>
  `${entry.lastName || ""} ${entry.firstName || ""}`.trim() || null;

const userName = (user) =>
  `${user?.lastName || ""} ${user?.firstName || ""}`.trim();

// «сегодня» / «вчера» / дд.мм — короткая метка дня для строк. День считается в
// бизнес-таймзоне: в браузерной лог, записанный вечером по времени компании,
// показывался бы «вчера» тому, кто смотрит западнее.
const dayLabel = (value) => {
  const diffDays = businessDaysAgo(value);
  if (diffDays === 0) return "сегодня";
  if (diffDays === 1) return "вчера";
  return formatDayMonth(value);
};

const authHeaders = () => ({
  Authorization: "Bearer " + getLocalStorageData().token,
});

// Карта фильтруется на клиенте — она загружена целиком
const accountMatches = (account, query) => {
  if (!query) return true;
  const term = query.toLowerCase();
  return [
    adName(account),
    account.activeDirectoryLogin,
    account.computerName,
    account.user && userName(account.user),
  ]
    .filter(Boolean)
    .some((value) => value.toLowerCase().includes(term));
};

// Метка блока внутри шторки (uppercase, как eyebrow карточек)
const BlockLabel = ({ children, count, hint }) => (
  <div className="tw:mb-2 tw:flex tw:items-baseline tw:gap-2 tw:text-xs tw:font-bold tw:tracking-wider tw:text-faint tw:uppercase">
    {children}
    {count != null && (
      <span className="tw:font-semibold tw:tracking-normal tw:tabular-nums">
        · {count}
      </span>
    )}
    {hint && (
      <span className="tw:ms-auto tw:font-normal tw:tracking-normal tw:normal-case">
        {hint}
      </span>
    )}
  </div>
);

const CompanyLogsOffcanvas = ({
  show,
  onHide,
  companyId,
  company = {},
  permissions = {},
  initialSearchQuery = "",
}) => {
  const canManage = permissions.canManageCompanies;

  const linkFetcher = useFetcher({ key: "linkUser" });
  const unlinkFetcher = useFetcher({ key: "unlinkUser" });

  const [accounts, setAccounts] = useState([]);
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery);
  // Последний реально загруженный запрос журнала — дебаунс-эффект не стреляет
  // ни при открытии, ни после программной загрузки
  const queryRef = useRef(initialSearchQuery);

  // Диалоги связи: открываются состоянием, данные — строка карты
  const [linkAccount, setLinkAccount] = useState(null);
  const [linkUser, setLinkUser] = useState(null);
  const [unlinkAccount, setUnlinkAccount] = useState(null);

  const loadAccounts = async () => {
    try {
      const response = await fetch(
        `${API}/api/companies/${companyId}/logs/accounts`,
        { headers: authHeaders() },
      );
      if (!response.ok) throw new Error(`accounts ${response.status}`);
      const data = await response.json();
      setAccounts(data.accounts || []);
    } catch (error) {
      console.warn("Карта учёток не загрузилась:", error);
    }
  };

  const loadLogs = async ({ nextPage = 1, query = queryRef.current, append = false } = {}) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        limit: String(PAGE_SIZE),
      });
      if (query.trim()) params.set("search", query.trim());
      const response = await fetch(
        `${API}/api/companies/${companyId}/logs?${params}`,
        { headers: authHeaders() },
      );
      if (!response.ok) throw new Error(`logs ${response.status}`);
      const data = await response.json();
      setLogs((prev) => (append ? [...prev, ...data.logs] : data.logs));
      setTotal(data.pagination?.count || 0);
      setPage(nextPage);
    } catch (error) {
      console.warn("Журнал не загрузился:", error);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const reloadAll = () => {
    loadAccounts();
    loadLogs({ nextPage: 1 });
  };

  // Открытие шторки: одна загрузка обоих блоков
  useEffect(() => {
    if (show && companyId) {
      const query = initialSearchQuery || "";
      setSearchQuery(query);
      queryRef.current = query;
      loadAccounts();
      loadLogs({ nextPage: 1, query });
    }
  }, [show, companyId]);

  // Серверный поиск журнала — только когда запрос реально изменился
  useEffect(() => {
    if (!show || searchQuery === queryRef.current) return undefined;
    const timeout = setTimeout(() => {
      queryRef.current = searchQuery;
      loadLogs({ nextPage: 1, query: searchQuery });
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchQuery, show]);

  const openLink = (account) => {
    setLinkUser(null);
    setLinkAccount(account);
  };

  const submitLink = (event) => {
    event.preventDefault();
    if (!linkUser || !linkAccount) return;
    linkFetcher.submit(
      {
        intent: "linkUserToAD",
        activeDirectoryObjectGUID: linkAccount.activeDirectoryObjectGUID,
        userId: linkUser._id,
      },
      { method: "POST", action: `/companies/${companyId}` },
    );
  };

  const submitUnlink = () => {
    if (!unlinkAccount?.user?._id) return;
    unlinkFetcher.submit(
      { intent: "unlinkUserFromAD", userId: unlinkAccount.user._id },
      { method: "POST", action: `/companies/${companyId}` },
    );
  };

  // Успех связывания/отвязки: закрыть диалог и перечитать оба блока
  useEffect(() => {
    if (
      linkFetcher.state === "idle" &&
      linkFetcher.data &&
      !linkFetcher.data.error &&
      linkAccount
    ) {
      setLinkAccount(null);
      setLinkUser(null);
      reloadAll();
    }
  }, [linkFetcher.state, linkFetcher.data]);

  useEffect(() => {
    if (
      unlinkFetcher.state === "idle" &&
      unlinkFetcher.data &&
      !unlinkFetcher.data.error &&
      unlinkAccount
    ) {
      setUnlinkAccount(null);
      reloadAll();
    }
  }, [unlinkFetcher.state, unlinkFetcher.data]);

  const busyLink = linkFetcher.state !== "idle";
  const busyUnlink = unlinkFetcher.state !== "idle";
  const hasMore = logs.length < total;

  const trimmedQuery = searchQuery.trim();
  const visibleAccounts = accounts.filter((account) =>
    accountMatches(account, trimmedQuery),
  );

  return (
    <>
      <Sheet
        open={show}
        onOpenChange={(open) => {
          if (!open) onHide();
        }}
      >
        <SheetContent
          side="bottom"
          // Единое поведение шторок (как FormSheet): на десктопе клик мимо не
          // закрывает — только крестик или Escape; на мобиле — по умолчанию
          onInteractOutside={
            isMobile ? undefined : (event) => event.preventDefault()
          }
          className="tw:inset-x-auto tw:left-1/2 tw:h-[90dvh] tw:w-full tw:max-w-4xl tw:-translate-x-1/2 tw:gap-0 tw:rounded-t-2xl tw:border tw:border-b-0 tw:border-border tw:p-0"
        >
          <div className="tw:flex tw:h-full tw:flex-col">
            <div className="tw:flex tw:items-baseline tw:gap-2.5 tw:px-6 tw:pt-4 tw:pb-2 tw:pr-12">
              <SheetTitle className="tw:my-0 tw:text-lg tw:font-semibold tw:tracking-tight">
                Лог активности — {company.alias}
              </SheetTitle>
              <span className="tw:text-sm tw:text-faint tw:tabular-nums">
                · {total} {plural(total, "событие", "события", "событий")}
              </span>
              <SheetDescription className="tw:sr-only">
                Кто за каким компьютером и журнал входов
              </SheetDescription>
            </div>

            {/* Поиск зафиксирован вне скролл-зоны — не пропадает при листании;
                фильтрует и карту (мгновенно), и журнал (серверно) */}
            <div className="tw:flex tw:gap-2 tw:border-b tw:border-border-soft tw:px-6 tw:pb-3.5">
              <span className="tw:relative tw:min-w-0 tw:flex-1">
                <RiSearchLine
                  size={16}
                  aria-hidden
                  className="tw:absolute tw:top-1/2 tw:left-3 tw:-translate-y-1/2 tw:text-faint"
                />
                <Input
                  type="search"
                  autoFocus
                  placeholder="Найти пользователя или компьютер…"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  className="tw:ps-9"
                />
              </span>
              <Button
                variant="outline"
                size="icon"
                title="Обновить"
                aria-label="Обновить"
                disabled={loading}
                onClick={reloadAll}
              >
                <RiRefreshLine />
              </Button>
            </div>

            <div className="tw:min-h-0 tw:flex-1 tw:overflow-y-auto tw:px-6 tw:pb-6">
              {/* Карта «кто за каким компьютером» — ответ на главный вопрос */}
              <div className="tw:mt-4">
                <BlockLabel
                  count={visibleAccounts.length || undefined}
                  hint="по последнему входу учётки"
                >
                  Кто за каким компьютером
                </BlockLabel>
                <div className="tw:rounded-xl tw:border tw:border-border tw:bg-card tw:px-4 tw:py-1.5">
                  {accounts.length === 0 ? (
                    <div className="tw:py-2.5 tw:text-sm tw:text-muted-foreground">
                      AD-агент ещё не приносил событий.
                    </div>
                  ) : visibleAccounts.length === 0 ? (
                    <div className="tw:py-2.5 tw:text-sm tw:text-muted-foreground">
                      Ничего не нашлось. Измените запрос.
                    </div>
                  ) : (
                    visibleAccounts.map((account) => {
                      const name = adName(account);
                      const displayName = account.user
                        ? userName(account.user)
                        : name;
                      return (
                        <div
                          key={account.activeDirectoryObjectGUID}
                          className="tw:flex tw:flex-wrap tw:items-center tw:gap-x-3 tw:gap-y-1 tw:border-t tw:border-border-soft tw:py-2.5 tw:first:border-t-0"
                        >
                          <span
                            aria-hidden
                            className={cn(
                              "tw:grid tw:size-9 tw:flex-none tw:place-items-center tw:rounded-full tw:bg-accent tw:text-xs tw:font-semibold tw:text-muted-foreground tw:inset-ring tw:inset-ring-border",
                              !displayName && "tw:font-mono tw:text-[10px]",
                            )}
                          >
                            {displayName ? monogramFor(displayName) : "AD"}
                          </span>
                          <span className="tw:min-w-0 tw:flex-1">
                            <span className="tw:block tw:truncate tw:text-[15px] tw:leading-tight tw:font-semibold">
                              {account.user ? (
                                <Link
                                  to={`/users/${account.user._id}`}
                                  onClick={onHide}
                                  className="tw:text-accent-text tw:no-underline tw:hover:underline"
                                >
                                  {displayName}
                                </Link>
                              ) : (
                                displayName || (
                                  <span className="tw:font-mono tw:text-sm tw:font-medium">
                                    {account.activeDirectoryLogin}
                                  </span>
                                )
                              )}
                            </span>
                            <span className="tw:block tw:truncate tw:font-mono tw:text-xs tw:text-faint">
                              {displayName && account.activeDirectoryLogin}
                              {!account.user && (
                                <span className="tw:font-sans tw:text-warning">
                                  {displayName ? " · " : ""}
                                  не связана с пользователем
                                </span>
                              )}
                            </span>
                          </span>
                          <span className="tw:flex tw:w-60 tw:flex-none tw:items-center tw:gap-2.5 tw:max-md:w-auto">
                            <RiComputerLine
                              size={17}
                              aria-hidden
                              className="tw:flex-none tw:text-faint"
                            />
                            <span className="tw:min-w-0">
                              <span className="tw:block tw:truncate tw:font-mono tw:text-sm tw:font-semibold">
                                {account.computerName || "—"}
                              </span>
                              <span className="tw:block tw:text-xs tw:text-faint tw:tabular-nums">
                                вход {dayLabel(account.lastSeenAt)}{" "}
                                {formatTime(account.lastSeenAt)}
                              </span>
                            </span>
                          </span>
                          {canManage && (
                            /* Гнездо действий постоянной ширины: у «Связать» и
                               иконки отвязки разная ширина — без фиксации
                               колонка компьютеров плыла по строкам */
                            <span className="tw:flex tw:w-28 tw:flex-none tw:items-center tw:justify-end">
                              {account.user ? (
                                <button
                                  type="button"
                                  title={`Отвязать учётку ${account.activeDirectoryLogin} от пользователя`}
                                  aria-label={`Отвязать учётку ${account.activeDirectoryLogin}`}
                                  disabled={busyUnlink || busyLink}
                                  onClick={() => setUnlinkAccount(account)}
                                  className="tw:grid tw:size-8 tw:cursor-pointer tw:appearance-none tw:place-items-center tw:rounded-lg tw:border-0 tw:bg-transparent tw:text-faint tw:transition-colors tw:hover:bg-accent tw:hover:text-muted-foreground"
                                >
                                  <RiUserUnfollowLine size={16} />
                                </button>
                              ) : (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={busyLink || busyUnlink}
                                  onClick={() => openLink(account)}
                                >
                                  <RiUserAddLine /> Связать
                                </Button>
                              )}
                            </span>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Журнал входов — история, без кнопок */}
              <div className="tw:mt-5">
                <BlockLabel>Журнал входов</BlockLabel>
                <div className="tw:rounded-xl tw:border tw:border-border tw:bg-card tw:px-4 tw:py-1.5">
                  {loading ? (
                    <Spinner className="tw:min-h-40" size={32} />
                  ) : logs.length === 0 ? (
                    <div className="tw:py-2.5 tw:text-sm tw:text-muted-foreground">
                      {queryRef.current
                        ? "Ничего не нашлось. Измените запрос."
                        : "Журнал пуст."}
                    </div>
                  ) : (
                    <>
                      {logs.map((log) => {
                        const name = adName(log);
                        return (
                          <div
                            key={log._id}
                            className="tw:flex tw:items-center tw:gap-3.5 tw:border-t tw:border-border-soft tw:py-2 tw:first:border-t-0"
                          >
                            <span
                              className="tw:w-24 tw:flex-none tw:text-sm tw:text-muted-foreground tw:tabular-nums"
                              title={formatDate(log.createdAt)}
                            >
                              {formatTime(log.createdAt)}{" "}
                              <span className="tw:text-xs tw:text-faint">
                                {dayLabel(log.createdAt)}
                              </span>
                            </span>
                            <span className="tw:min-w-0 tw:flex-1 tw:truncate tw:text-sm">
                              <span
                                className={cn(
                                  "tw:font-medium",
                                  !name && "tw:font-mono",
                                )}
                              >
                                {name || log.activeDirectoryLogin}
                              </span>
                              {name && (
                                <span className="tw:ms-2 tw:font-mono tw:text-xs tw:text-faint">
                                  {log.activeDirectoryLogin}
                                </span>
                              )}
                              {log.computerName && (
                                <span className="tw:text-muted-foreground tw:md:hidden">
                                  {" "}
                                  · {log.computerName}
                                </span>
                              )}
                            </span>
                            <span className="tw:hidden tw:w-48 tw:flex-none tw:items-center tw:gap-2 tw:text-sm tw:text-muted-foreground tw:md:flex">
                              {log.computerName && (
                                <>
                                  <RiComputerLine
                                    size={15}
                                    aria-hidden
                                    className="tw:flex-none tw:text-faint"
                                  />
                                  <span className="tw:truncate tw:font-mono tw:text-[13px]">
                                    {log.computerName}
                                  </span>
                                </>
                              )}
                            </span>
                          </div>
                        );
                      })}

                      {hasMore && (
                        <div className="tw:flex tw:flex-col tw:items-center tw:gap-1.5 tw:border-t tw:border-border-soft tw:py-3.5">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={loadingMore}
                            onClick={() => loadLogs({ nextPage: page + 1, append: true })}
                          >
                            {loadingMore ? "Загрузка…" : "Показать ещё"}
                          </Button>
                          <span className="tw:text-xs tw:text-faint tw:tabular-nums">
                            Показано {logs.length} из {total}
                          </span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Связать учётку с пользователем */}
      <Dialog
        open={Boolean(linkAccount)}
        onOpenChange={(open) => {
          if (!open) setLinkAccount(null);
        }}
      >
        <DialogContent className="tw:max-w-md" aria-describedby={undefined}>
          <InsideOverlayContext.Provider value={true}>
            <DialogHeader>
              <DialogTitle>Связать с пользователем</DialogTitle>
            </DialogHeader>

            {linkFetcher.data?.error && (
              <AlertMessage
                variant="danger"
                message={
                  linkFetcher.data.message || "Не удалось связать учётку"
                }
              />
            )}

            {linkAccount && (
              <div className="tw:rounded-xl tw:border tw:border-border-soft tw:bg-accent/40 tw:px-4 tw:py-3 tw:text-sm">
                <div className="tw:font-medium">
                  {adName(linkAccount) || "AD-учётка"}
                  <span className="tw:ms-2 tw:font-mono tw:text-xs tw:font-normal tw:text-muted-foreground">
                    {linkAccount.activeDirectoryLogin}
                  </span>
                </div>
                <div className="tw:mt-0.5 tw:font-mono tw:text-xs tw:text-faint">
                  GUID: {linkAccount.activeDirectoryObjectGUID}
                </div>
              </div>
            )}

            <form onSubmit={submitLink}>
              <Field
                label="Пользователь"
                required
                hint="Все записи входов этой учётки будут привязаны к выбранному пользователю."
              >
                <Select
                  placeholder="Выберите пользователя компании"
                  isClearable
                  isSearchable
                  options={company.employees || []}
                  value={linkUser}
                  onChange={(next) => setLinkUser(next || null)}
                  getOptionLabel={(option) =>
                    `${option.lastName || ""} ${option.firstName || ""}`.trim()
                  }
                  getOptionValue={(option) => option._id}
                />
              </Field>

              <DialogFooter className="tw:mt-1">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setLinkAccount(null)}
                >
                  Отмена
                </Button>
                <Button type="submit" disabled={busyLink || !linkUser}>
                  {busyLink ? "Связывание…" : "Связать"}
                </Button>
              </DialogFooter>
            </form>
          </InsideOverlayContext.Provider>
        </DialogContent>
      </Dialog>

      {/* Отвязать учётку */}
      <AlertDialog
        open={Boolean(unlinkAccount)}
        onOpenChange={(open) => {
          if (!open) setUnlinkAccount(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {adName(unlinkAccount || {}) ||
                unlinkAccount?.activeDirectoryLogin}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Записи всех входов этой учётки станут несвязанными с пользователем{" "}
              {unlinkAccount?.user ? userName(unlinkAccount.user) : ""}. Связь
              можно будет создать заново.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {unlinkFetcher.data?.error && (
            <AlertMessage
              variant="danger"
              message={
                unlinkFetcher.data.message || "Не удалось отвязать учётку"
              }
            />
          )}
          <AlertDialogFooter className="tw:mt-4">
            <AlertDialogCancel type="button">Отмена</AlertDialogCancel>
            <Button
              variant="warning"
              disabled={busyUnlink}
              onClick={submitUnlink}
            >
              <RiUserUnfollowLine /> {busyUnlink ? "Отвязка…" : "Отвязать"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default CompanyLogsOffcanvas;
