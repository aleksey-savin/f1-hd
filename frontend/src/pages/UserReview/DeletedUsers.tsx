import { useEffect, useState } from "react";
import { Link, useFetcher, useLoaderData, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import PageShell from "@/components/app/PageShell";
import { Panel } from "@/components/app/Panel";
import ConfirmDialog from "@/components/app/ConfirmDialog";
import { formatDate } from "@/util/format-date";
import type { ReviewActionResult, ReviewUser } from "@/types/userReview";

export default function DeletedUsers() {
  const { users, total } = useLoaderData() as {
    users: ReviewUser[];
    total: number;
  };
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get("page")) || 1);
  const fetcher = useFetcher<ReviewActionResult>();
  const [restore, setRestore] = useState<ReviewUser | null>(null);
  useEffect(() => {
    if (
      fetcher.state === "idle" &&
      fetcher.data?.message &&
      !fetcher.data.error
    )
      setRestore(null);
  }, [fetcher.state, fetcher.data]);
  return (
    <PageShell
      title="Удалённые пользователи"
      breadcrumb={
        <Link
          className="text-sm text-muted-foreground no-underline"
          to="/users"
        >
          ‹ Пользователи
        </Link>
      }
      subtitle="Заявки, работы и история сохраняют ссылки на эти записи"
    >
      <Panel>
        {users.length ? (
          users.map((user) => (
            <div
              key={user._id}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-border-soft py-3 first:pt-0 last:border-0 last:pb-0"
            >
              <div className="min-w-0">
                <Link
                  to={`/users/${user._id}`}
                  className="text-sm font-semibold text-foreground no-underline"
                >
                  {user.lastName} {user.firstName}
                </Link>
                <div className="mt-1 text-xs text-muted-foreground">
                  {user.company?.alias}
                  {user.deletedAt && ` · удалён ${formatDate(user.deletedAt)}`}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRestore(user)}
              >
                Восстановить
              </Button>
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">
            Удалённых пользователей нет.
          </p>
        )}
      </Panel>
      {total > 30 && (
        <div className="mt-4 flex items-center justify-between gap-2">
          <Button
            variant="outline"
            disabled={page <= 1}
            onClick={() => setParams({ page: String(page - 1) })}
          >
            Предыдущая
          </Button>
          <span className="text-xs text-muted-foreground">
            Страница {page} · всего {total}
          </span>
          <Button
            variant="outline"
            disabled={page * 30 >= total}
            onClick={() => setParams({ page: String(page + 1) })}
          >
            Следующая
          </Button>
        </div>
      )}
      {fetcher.data?.message && (
        <p role="status" className="mt-3 text-sm text-accent-text">
          {fetcher.data.message}
        </p>
      )}
      <ConfirmDialog
        open={!!restore}
        onOpenChange={(open) => {
          if (!open) setRestore(null);
        }}
        title={`Восстановить ${restore?.lastName || ""} ${restore?.firstName || ""}?`}
        description="Запись вернётся в рабочие списки. Доступ останется отключённым до отдельного включения."
        confirmLabel="Восстановить"
        isLoading={fetcher.state !== "idle"}
        onConfirm={() => {
          if (restore)
            fetcher.submit(
              { intent: "restore", id: restore._id },
              { method: "post" },
            );
        }}
      >
        {fetcher.data?.error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {fetcher.data.error}
          </p>
        )}
      </ConfirmDialog>
    </PageShell>
  );
}
