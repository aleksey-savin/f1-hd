import { useEffect, useState } from "react";

import { Link } from "react-router";
import { RiDeleteBinLine } from "react-icons/ri";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SubLabel } from "@/components/app/Panel";

import { formatDate } from "../../util/format-date";
import useToastStore from "../../store/toast-store";

// Правила ИИ — замечания, оставленные на карточках заявок.
//
// Форма их не редактирует и в группу ai они не входят: замечание пишет тот, кто
// увидел ошибку, а администратор только решает, пускать ли его в промпты. Пока
// правило выключено, модель о нём не знает — иначе одна эмоциональная
// формулировка тихо испортила бы генерации всему отделу.
const TARGET_LABEL = {
  description: "описание из звонка",
  category: "подбор категории",
};
const REASON_LABEL = {
  offtopic: "не по делу",
  facts: "ошибка в фактах",
  invented: "выдумано",
  outdated: "устарело",
};

const AiRules = () => {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const showToast = useToastStore((state) => state.showToast);

  const request = async (path, options) => {
    const response = await fetch(
      `${import.meta.env.VITE_API_ADDRESS}/api/preferences/${path}`,
      {
        ...options,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message);
    return data;
  };

  useEffect(() => {
    request("ai-rules")
      .then((data) => setRules(data.rules || []))
      .catch(() => setRules([]))
      .finally(() => setLoading(false));
  }, []);

  const toggle = async (rule, isActive) => {
    setBusyId(rule._id);
    try {
      const data = await request("ai-rules/toggle", {
        method: "POST",
        body: JSON.stringify({ _id: rule._id, isActive }),
      });
      setRules((current) =>
        current.map((item) =>
          item._id === rule._id ? { ...item, isActive } : item,
        ),
      );
      showToast("success", data.message);
    } catch (error) {
      showToast("danger", error.message || "Не удалось изменить правило");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (rule) => {
    setBusyId(rule._id);
    try {
      const data = await request("ai-rules/delete", {
        method: "POST",
        body: JSON.stringify({ _id: rule._id }),
      });
      setRules((current) => current.filter((item) => item._id !== rule._id));
      showToast("success", data.message);
    } catch (error) {
      showToast("danger", error.message || "Не удалось удалить правило");
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return null;

  return (
    <>
      <div className="px-5 pt-4">
        <SubLabel>Правила от сотрудников</SubLabel>
      </div>

      {rules.length === 0 ? (
        <p className="px-5 pb-4 text-sm text-muted-foreground">
          Замечаний пока нет. Они появляются, когда кто-то нажимает на метку ИИ
          в карточке заявки и объясняет, что модель поняла неверно.
        </p>
      ) : (
        <>
          <p className="px-5 pb-1 text-sm text-muted-foreground">
            Включённое правило уходит в запрос к модели по своей категории и
            компании. Выключенное лежит на виду у команды, но на ответы не
            влияет.
          </p>
          <ul className="m-0 list-none p-0">
            {rules.map((rule) => (
              <li
                key={rule._id}
                className="flex items-start gap-3 border-t border-border-soft px-5 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="my-0 text-sm">{rule.text}</p>
                  <p className="mt-1 mb-0 text-xs text-faint">
                    {TARGET_LABEL[rule.target] || rule.target} ·{" "}
                    {REASON_LABEL[rule.reason] || rule.reason}
                    {rule.category?.title ? ` · ${rule.category.title}` : ""}
                    {rule.company?.alias ? ` · ${rule.company.alias}` : ""}
                    {rule.ticketNum ? " · " : ""}
                    {rule.ticketNum && (
                      <Link
                        to={`/tickets/${rule.ticketNum}`}
                        className="text-faint hover:text-accent-text"
                      >
                        заявка № {rule.ticketNum}
                      </Link>
                    )}
                    {rule.createdAt ? ` · ${formatDate(rule.createdAt)}` : ""}
                  </p>
                </div>

                <Switch
                  checked={!!rule.isActive}
                  disabled={busyId === rule._id}
                  onCheckedChange={(value) => toggle(rule, value)}
                  aria-label="Учитывать правило"
                />
                <Button
                  variant="ghost"
                  size="icon-xs"
                  disabled={busyId === rule._id}
                  onClick={() => remove(rule)}
                  title="Удалить правило"
                  aria-label="Удалить правило"
                >
                  <RiDeleteBinLine />
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
};

export default AiRules;
