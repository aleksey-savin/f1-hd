import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { RiRestartLine } from "react-icons/ri";
import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/app/ConfirmDialog";
import type { ReviewActionResult } from "@/types/userReview";

export default function RestoreUserButton({
  userId,
  name,
}: {
  userId: string;
  name: string;
}) {
  const [open, setOpen] = useState(false);
  const fetcher = useFetcher<ReviewActionResult>();
  useEffect(() => {
    if (
      fetcher.state === "idle" &&
      fetcher.data?.message &&
      !fetcher.data.error
    )
      setOpen(false);
  }, [fetcher.state, fetcher.data]);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <RiRestartLine />
        Восстановить
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Восстановить ${name}?`}
        description="Пользователь вернётся в рабочие списки. Доступ останется отключённым до отдельного включения."
        confirmLabel="Восстановить"
        isLoading={fetcher.state !== "idle"}
        onConfirm={() =>
          fetcher.submit(
            { intent: "restore", id: userId },
            { method: "post", action: "/users/deleted" },
          )
        }
      >
        {fetcher.data?.error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {fetcher.data.error}
          </p>
        )}
      </ConfirmDialog>
    </>
  );
}
