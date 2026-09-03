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
import { cn } from "@/lib/utils";

import Combobox, { toOptions } from "@/components/app/Combobox";
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
  <div className="mb-2 flex items-baseline gap-2 text-xs font-bold tracking-wider text-faint uppercase">
    {children}
    {count != null && (
      <span className="font-semibold tracking-normal tabular-nums">
        · {count}
      </span>
    )}
    {hint && (
      <span className="ms-auto font-normal tracking-normal normal-case">
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
  can,
  initialSearchQuery = "",
}) => {
  const canManage = can({ company: ["readLogs"] });

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

  const loadLogs = async ({
    nextPage = 1,
    query = queryRef.current,
    append = false,
  } = {}) => {
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
          className="inset-x-auto left-1/2 h-[90dvh] w-full max-w-4xl -translate-x-1/2 gap-0 rounded-t-2xl border border-b-0 border-border p-0"
        >
          <div className="flex h-full flex-col">
            <div className="flex items-baseline gap-2.5 px-6 pt-4 pb-2 pr-12">
              <SheetTitle className="my-0 text-lg font-semibold tracking-tight">
                Лог активности — {company.alias}
              </SheetTitle>
              <span className="text-sm text-faint tabular-nums">
                · {total} {plural(total, "событие", "события", "событий")}
              </span>
              <SheetDescription className="sr-only">
                Кто за каким компьютером и журнал входов
              </SheetDescription>
            </div>

            {/* Поиск зафиксирован вне скролл-зоны — не пропадает при листании;
                фильтрует и карту (мгновенно), и журнал (серверно) */}
            <div className="flex gap-2 border-b border-border-soft px-6 pb-3.5">
              <span className="relative min-w-0 flex-1">
                <RiSearchLine
                  size={16}
                  aria-hidden
                  className="absolute top-1/2 left-3 -translate-y-1/2 text-faint"
                />
                <Input
                  type="search"
                  autoFocus
                  placeholder="Найти пользователя или компьютер…"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  className="ps-9"
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

            <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
              {/* Карта «кто за каким компьютером» — ответ на главный вопрос */}
              <div className="mt-4">
                <BlockLabel
                  count={visibleAccounts.length || undefined}
                  hint="по последнему входу учётки"
                >
                  Кто за каким компьютером
                </BlockLabel>
                <div className="rounded-xl border border-border bg-card px-4 py-1.5">
                  {accounts.length === 0 ? (
                    <div className="py-2.5 text-sm text-muted-foreground">
                      AD-агент ещё не приносил событий.
                    </div>
                  ) : visibleAccounts.length === 0 ? (
                    <div className="py-2.5 text-sm text-muted-foreground">
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
                          className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border-soft py-2.5 first:border-t-0"
                        >
                          <span
                            aria-hidden
                            className={cn(
                              "grid size-9 flex-none place-items-center rounded-full bg-accent text-xs font-semibold text-muted-foreground inset-ring inset-ring-border",
                              !displayName && "font-mono text-xs",
                            )}
                          >
                            {displayName ? monogramFor(displayName) : "AD"}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm leading-tight font-semibold">
                              {account.user ? (
                                <Link
                                  to={`/users/${account.user._id}`}
                                  onClick={onHide}
                                  className="text-accent-text no-underline hover:underline"
                                >
                                  {displayName}
                                </Link>
                              ) : (
                                displayName || (
                                  <span className="font-mono text-sm font-medium">
                                    {account.activeDirectoryLogin}
                                  </span>
                                )
                              )}
                            </span>
                            <span className="block truncate font-mono text-xs text-faint">
                              {displayName && account.activeDirectoryLogin}
                              {!account.user && (
                                <span className="font-sans text-warning">
                                  {displayName ? " · " : ""}
                                  не связана с пользователем
                                </span>
                              )}
                            </span>
                          </span>
                          <span className="flex w-60 flex-none items-center gap-2.5 max-md:w-auto">
                            <RiComputerLine
                              size={17}
                              aria-hidden
                              className="flex-none text-faint"
                            />
                            <span className="min-w-0">
                              <span className="block truncate font-mono text-sm font-semibold">
                                {account.computerName || "—"}
                              </span>
                              <span className="block text-xs text-faint tabular-nums">
                                вход {dayLabel(account.lastSeenAt)}{" "}
                                {formatTime(account.lastSeenAt)}
                              </span>
                            </span>
                          </span>
                          {canManage && (
                            /* Гнездо действий постоянной ширины: у «Связать» и
                               иконки отвязки разная ширина — без фиксации
                               колонка компьютеров плыла по строкам */
                            <span className="flex w-28 flex-none items-center justify-end">
                              {account.user ? (
                                <button
                                  type="button"
                                  title={`Отвязать учётку ${account.activeDirectoryLogin} от пользователя`}
                                  aria-label={`Отвязать учётку ${account.activeDirectoryLogin}`}
                                  disabled={busyUnlink || busyLink}
                                  onClick={() => setUnlinkAccount(account)}
                                  className="grid size-8 cursor-pointer appearance-none place-items-center rounded-lg border-0 bg-transparent text-faint transition-colors hover:bg-accent hover:text-muted-foreground"
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
              <div className="mt-5">
                <BlockLabel>Журнал входов</BlockLabel>
                <div className="rounded-xl border border-border bg-card px-4 py-1.5">
                  {loading ? (
                    <Spinner className="min-h-40" size={32} />
                  ) : logs.length === 0 ? (
                    <div className="py-2.5 text-sm text-muted-foreground">
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
                            className="flex items-center gap-3.5 border-t border-border-soft py-2 first:border-t-0"
                          >
                            <span
                              className="w-24 flex-none text-sm text-muted-foreground tabular-nums"
                              title={formatDate(log.createdAt)}
                            >
                              {formatTime(log.createdAt)}{" "}
                              <span className="text-xs text-faint">
                                {dayLabel(log.createdAt)}
                              </span>
                            </span>
                            <span className="min-w-0 flex-1 truncate text-sm">
                              <span
                                className={cn(
                                  "font-medium",
                                  !name && "font-mono",
                                )}
                              >
                                {name || log.activeDirectoryLogin}
                              </span>
                              {name && (
                                <span className="ms-2 font-mono text-xs text-faint">
                                  {log.activeDirectoryLogin}
                                </span>
                              )}
                              {log.computerName && (
                                <span className="text-muted-foreground md:hidden">
                                  {" "}
                                  · {log.computerName}
                                </span>
                              )}
                            </span>
                            <span className="hidden w-48 flex-none items-center gap-2 text-sm text-muted-foreground md:flex">
                              {log.computerName && (
                                <>
                                  <RiComputerLine
                                    size={15}
                                    aria-hidden
                                    className="flex-none text-faint"
                                  />
                                  <span className="truncate font-mono text-sm">
                                    {log.computerName}
                                  </span>
                                </>
                              )}
                            </span>
                          </div>
                        );
                      })}

                      {hasMore && (
                        <div className="flex flex-col items-center gap-1.5 border-t border-border-soft py-3.5">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={loadingMore}
                            onClick={() =>
                              loadLogs({ nextPage: page + 1, append: true })
                            }
                          >
                            {loadingMore ? "Загрузка…" : "Показать ещё"}
                          </Button>
                          <span className="text-xs text-faint tabular-nums">
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
        <DialogContent className="max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Связать с пользователем</DialogTitle>
          </DialogHeader>

          {linkFetcher.data?.error && (
            <AlertMessage
              variant="danger"
              message={linkFetcher.data.message || "Не удалось связать учётку"}
            />
          )}

          {linkAccount && (
            <div className="rounded-xl border border-border-soft bg-accent/40 px-4 py-3 text-sm">
              <div className="font-medium">
                {adName(linkAccount) || "AD-учётка"}
                <span className="ms-2 font-mono text-xs font-normal text-muted-foreground">
                  {linkAccount.activeDirectoryLogin}
                </span>
              </div>
              <div className="mt-0.5 font-mono text-xs text-faint">
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
              <Combobox
                ariaLabel="Пользователь компании"
                placeholder="Выберите пользователя компании"
                options={toOptions(company.employees || [], {
                  value: (option) => String(option._id),
                  label: (option) =>
                    `${option.lastName || ""} ${option.firstName || ""}`.trim(),
                })}
                value={linkUser?._id ? String(linkUser._id) : null}
                onChange={(id) =>
                  setLinkUser(
                    (company.employees || []).find(
                      (option) => String(option._id) === id,
                    ) || null,
                  )
                }
                clearable
                clearLabel="Не выбран"
              />
            </Field>

            <DialogFooter className="mt-1">
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
          <AlertDialogFooter className="mt-4">
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
