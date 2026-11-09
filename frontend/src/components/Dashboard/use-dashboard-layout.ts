import { useEffect, useRef, useState } from "react";
import { useBlocker } from "react-router";

import useRefreshRoute from "@/components/app/use-refresh-route";
import { api } from "@/lib/api";
import useToastStore from "@/store/toast-store";
import type { DashboardAudience, DashboardLayout } from "@/types/dashboard";

import { defaultLayout, reconcileLayout } from "./layout";

export default function useDashboardLayout(
  initial: DashboardLayout | null | undefined,
  audience: DashboardAudience,
) {
  const [saved, setSaved] = useState(() => reconcileLayout(initial, audience));
  const [draft, setDraft] = useState<DashboardLayout | null>(null);
  const [base, setBase] = useState(saved);
  const [saving, setSaving] = useState(false);
  const request = useRef<AbortController | null>(null);
  const source = JSON.stringify(initial ?? null);
  const refresh = useRefreshRoute();
  const showToast = useToastStore((state) => state.showToast);

  // Root revalidation can bring another device's settings. Preserve an open
  // draft, but let Cancel restore the latest confirmed layout.
  useEffect(() => {
    if (!request.current) setSaved(reconcileLayout(initial, audience));
  }, [source, audience]);
  useEffect(() => () => request.current?.abort(), []);

  const editing = draft !== null;
  const dirty = editing && JSON.stringify(draft) !== JSON.stringify(base);
  const blocker = useBlocker(dirty || saving);

  useEffect(() => {
    if (!dirty && !saving) return;
    const prevent = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty, saving]);

  const start = () => {
    setBase(saved);
    setDraft(saved);
  };
  const cancel = () => {
    if (!request.current) setDraft(null);
  };
  const reset = () => setDraft(defaultLayout(audience));
  const save = async () => {
    if (!draft || request.current) return;
    if (!dirty) {
      setDraft(null);
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setSaving(true);
    const payload =
      JSON.stringify(draft) === JSON.stringify(defaultLayout(audience))
        ? null
        : draft;
    try {
      const result = await api<{
        user: { dashboardLayout: DashboardLayout | null };
      }>("/api/users/update-account", {
        method: "POST",
        body: { dashboardLayout: payload },
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setSaved(reconcileLayout(result.user.dashboardLayout, audience));
      setDraft(null);
      showToast("success", "Настройка Главной сохранена");
      refresh();
    } catch (error) {
      if (!controller.signal.aborted)
        showToast(
          "danger",
          error instanceof Error
            ? error.message
            : "Не удалось сохранить настройку Главной",
        );
    } finally {
      if (!controller.signal.aborted) {
        request.current = null;
        setSaving(false);
      }
    }
  };

  useEffect(() => {
    if (!editing) return;
    const keyboard = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
      // Escape inside a popup belongs to that popup. Cancel has its own button.
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  });

  return {
    layout: draft ?? saved,
    editing,
    dirty,
    saving,
    blocker,
    start,
    cancel,
    reset,
    save,
    setDraft,
  };
}
