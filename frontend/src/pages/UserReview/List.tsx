import { useEffect, useRef, useState } from "react";
import {
  Link,
  useLoaderData,
  useSearchParams,
  useLocation,
  useNavigationType,
  useNavigation,
} from "react-router";
import {
  RiArrowRightSLine,
  RiCheckLine,
  RiSparkling2Line,
} from "react-icons/ri";
import { Button } from "@/components/ui/button";
import PageShell from "@/components/app/PageShell";
import { Panel } from "@/components/app/Panel";
import Segmented from "@/components/app/Segmented";
import ChipSelect from "@/components/app/ChipSelect";
import ChipCombobox from "@/components/app/ChipCombobox";
import SearchBar from "@/components/app/SearchBar";
import Pager from "@/components/app/Pager";
import UserAvatar from "@/components/User/UserAvatar";
import { useCan } from "@/store/authed-user";
import useLiveRouteRevalidate from "@/hooks/use-live-route-revalidate";
import ProposalDetail, {
  kindLabel,
  proposalName,
  proposalUser,
} from "@/components/UserReview/ProposalDetail";
import ReviewStatusBadge from "@/components/UserReview/ReviewStatusBadge";
import { changeReviewQuery } from "@/components/UserReview/queue-navigation";
import type {
  ReviewPage,
  ReviewProposal,
  ReviewSummary,
} from "@/types/userReview";
import { cn } from "@/lib/utils";

export default function UserReviewList() {
  const { proposals, summary } = useLoaderData() as {
    proposals: ReviewPage<ReviewProposal>;
    summary: ReviewSummary;
  };
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigationType = useNavigationType();
  const navigation = useNavigation();
  const queryIntent = useRef(params);
  const [search, setSearch] = useState(params.get("q") || "");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    },
    [],
  );
  useEffect(() => {
    // A pending external navigation (including Back) wins over unsubmitted typing.
    if (navigation.location) {
      if (navigation.location.pathname !== location.pathname) {
        if (searchTimer.current) clearTimeout(searchTimer.current);
        searchTimer.current = null;
        return;
      }
      const incoming = new URLSearchParams(navigation.location.search);
      if (incoming.toString() !== queryIntent.current.toString()) {
        if (searchTimer.current) clearTimeout(searchTimer.current);
        searchTimer.current = null;
        queryIntent.current = incoming;
        setSearch(incoming.get("q") || "");
      }
      return;
    }
    const alreadyApplied = queryIntent.current.toString() === params.toString();
    queryIntent.current = params;
    if (navigationType !== "POP" || alreadyApplied) return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = null;
    setSearch(params.get("q") || "");
  }, [
    location.key,
    location.pathname,
    navigationType,
    params,
    navigation.location,
  ]);
  const selected = params.get("selected") || "";
  const can = useCan();
  useLiveRouteRevalidate("userReview");
  const change = (key: string, value: string | null) => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = null;
    const next = changeReviewQuery(queryIntent.current, key, value, search);
    queryIntent.current = next;
    setParams(next, {
      replace: key === "selected",
      preventScrollReset: true,
    });
  };
  const changeSearch = (value: string) => {
    setSearch(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      searchTimer.current = null;
      const next = changeReviewQuery(queryIntent.current, "q", value);
      queryIntent.current = next;
      setParams(next, {
        replace: true,
        preventScrollReset: true,
      });
    }, 300);
  };
  const hasFilters = ["q", "companyId", "kind", "ticketId"].some((key) =>
    params.has(key),
  );
  const clearFilters = () => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = null;
    setSearch("");
    let next = queryIntent.current;
    for (const key of ["q", "companyId", "kind", "ticketId"])
      next = changeReviewQuery(next, key, null);
    queryIntent.current = next;
    setParams(next, { preventScrollReset: true });
  };
  const current =
    proposals.items.find((proposal) => proposal._id === selected) ||
    proposals.items[0];
  return (
    <PageShell
      title="Проверка пользователей"
      breadcrumb={
        <Link
          to="/users"
          className="text-sm text-muted-foreground no-underline"
        >
          ‹ Пользователи
        </Link>
      }
      subtitle="Предложения по заявкам, активности и сроку отключения"
      search={
        <SearchBar
          value={search}
          onChange={(event) => changeSearch(event.target.value)}
          placeholder="Имя, почта, должность, компания"
          ariaLabel="Поиск пользователей для проверки"
          maxLength={200}
        />
      }
      toolbar={
        <>
          <ChipCombobox
            placeholder="Компания"
            allLabel="Все компании"
            value={params.get("companyId")}
            onChange={(value) => change("companyId", value)}
            options={summary.companies.map((company) => ({
              value: company._id,
              label: company.alias,
            }))}
          />
          <ChipSelect
            placeholder="Все основания"
            value={params.get("kind")}
            onChange={(value) => change("kind", value)}
            options={Object.entries(kindLabel).map(([value, label]) => ({
              value,
              label,
            }))}
          />
        </>
      }
      action={
        <Button asChild variant="outline">
          <Link to="/users/review/analysis">
            <RiSparkling2Line />
            Анализ заявок
          </Link>
        </Button>
      }
    >
      {!summary.settings.enabled && (
        <Panel className="mb-4">
          <p className="text-sm text-muted-foreground">
            Автоматическая проверка пользователей выключена.
            {can({ settings: ["manage"] }) && (
              <>
                {" "}
                <Link
                  className="text-accent-text"
                  to="/preferences#user-review"
                >
                  Включить в настройках системы
                </Link>
              </>
            )}
          </p>
        </Panel>
      )}
      <div className="mb-5">
        <Segmented
          fit
          compact
          ariaLabel="Решение по предложению"
          value={params.get("status") || "pending"}
          onChange={(value) => change("status", value)}
          options={[
            { value: "pending", label: "Ждут решения", count: summary.pending },
            {
              value: "deferred",
              label: "Отложены",
              count: summary.byStatus.deferred,
            },
            { value: "all", label: "Все", count: summary.total },
          ]}
        />
      </div>
      {!summary.canManage && (
        <p className="mb-4 text-sm text-muted-foreground">
          Доступен просмотр. Для решений нужно право «Вести проверку
          пользователей».
        </p>
      )}
      {!!summary.unknownDisabled && (
        <p className="mb-4 text-xs text-muted-foreground">
          У {summary.unknownDisabled} отключённых учётных записей дата
          отключения неизвестна. Для предложения удаления по сроку нужна
          достоверная дата отключения.
        </p>
      )}
      {!proposals.items.length ? (
        <Panel>
          <div className="py-8 text-center">
            <RiCheckLine className="mx-auto mb-3 text-accent-text" size={28} />
            <h2 className="text-lg font-semibold">
              {hasFilters
                ? "Ничего не нашлось"
                : "Предложений в этой очереди нет"}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {hasFilters
                ? "Измените запрос или сбросьте фильтры."
                : "Новые результаты появятся после проверки заявок и пользователей."}
            </p>
            {hasFilters ? (
              <Button variant="outline" className="mt-4" onClick={clearFilters}>
                Сбросить фильтры
              </Button>
            ) : (
              <Button asChild variant="outline" className="mt-4">
                <Link to="/users/review/analysis">Открыть анализ заявок</Link>
              </Button>
            )}
          </div>
        </Panel>
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-5">
          <Panel className="overflow-hidden p-0 xl:col-span-2">
            {proposals.items.map((proposal) => {
              const user = proposalUser(proposal);
              return (
                <button
                  key={proposal._id}
                  aria-pressed={current?._id === proposal._id}
                  onClick={() => change("selected", proposal._id)}
                  className={cn(
                    "flex w-full appearance-none items-center gap-3 border-0 border-b border-border-soft bg-transparent px-5 py-4 text-left last:border-b-0 hover:bg-accent",
                    current?._id === proposal._id && "bg-accent",
                  )}
                >
                  {user && <UserAvatar user={user} sizeClass="size-10" />}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">
                      {proposalName(proposal)}
                    </div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">
                      {user?.company?.alias}
                      {user?.company?.alias && " · "}
                      {kindLabel[proposal.kind]}
                    </div>
                    {params.get("status") === "all" && (
                      <div className="mt-2">
                        <ReviewStatusBadge status={proposal.status} />
                      </div>
                    )}
                  </div>
                  <RiArrowRightSLine className="shrink-0 text-faint" />
                </button>
              );
            })}
          </Panel>
          <Panel className="xl:col-span-3">
            {current && (
              <ProposalDetail
                key={current._id}
                proposal={current}
                showStatus={params.get("status") === "all"}
              />
            )}
          </Panel>
        </div>
      )}
      <Pager
        page={proposals.page}
        pageSize={proposals.pageSize}
        total={proposals.total}
        loaded={proposals.items.length}
        mobileMode="pages"
        onPage={(page) => change("page", String(page))}
        onLoadMore={() => change("page", String(proposals.page + 1))}
      />
      <p className="mt-4 text-xs text-faint">
        Анализ предлагает кандидатов. Отключение и удаление выполняет сотрудник
        после проверки основания.
      </p>
    </PageShell>
  );
}
