import { Link } from "react-router";

import { Eyebrow, Panel } from "@/components/app/Panel";
import { MODERATION_FILTERS } from "../KnowledgeBase/Filter";
import useModerationSummary from "../KnowledgeBase/useModerationSummary";

/**
 * «База знаний ждёт внимания» — очереди модерации со счётчиками.
 *
 * Переехало сюда с уровня оболочки: до этого те же цифры показывал баннер
 * поверх любой страницы (`components/KnowledgeBase/ModerationBanner`). Пока
 * главной не было, баннер был единственным способом их показать; теперь есть
 * страница, на которую человек приходит именно за «что требует внимания», и
 * держать две поверхности с одним содержимым незачем.
 *
 * Счётчики очередей НЕ складываем: заметка попадает сразу в несколько очередей,
 * и `total` считается отдельным `$or` на бэкенде.
 *
 * Читается как список работы, а не как тревога: неутверждённых заметок в базе
 * 134 из 176 — это накопленный бэклог, и красным тут была бы вся секция.
 */
const KbAttention = () => {
  const { counts, isModerator, scanForSecrets } = useModerationSummary();

  if (!isModerator) return null;

  const queues = MODERATION_FILTERS.filter(
    (queue) =>
      (!queue.needsSecretsScan || scanForSecrets) &&
      counts?.[queue.countKey] > 0,
  );
  if (queues.length === 0) return null;

  return (
    <section>
      <Eyebrow>База знаний ждёт внимания</Eyebrow>
      <Panel>
        <div className="flex flex-wrap gap-2">
          {queues.map((queue) => (
            <Link
              key={queue.mode}
              to={`/knowledge-base?moderation=${queue.mode}`}
              className="inline-flex items-baseline gap-2 rounded-full border border-border px-3 py-1.5 text-sm text-muted-foreground no-underline transition-colors hover:border-primary hover:text-muted-foreground"
            >
              {queue.label}
              <span
                className={
                  "font-semibold tabular-nums " +
                  // Найденные учётные данные — единственная очередь, где цифра
                  // означает риск, а не объём работы.
                  (queue.mode === "flagged-secrets"
                    ? "text-destructive"
                    : "text-foreground")
                }
              >
                {counts[queue.countKey]}
              </span>
            </Link>
          ))}
        </div>
      </Panel>
    </section>
  );
};

export default KbAttention;
