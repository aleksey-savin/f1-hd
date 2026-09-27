import { Link } from "react-router";

import HealthRow from "@/components/app/HealthRow";
import { Button } from "@/components/ui/button";

/**
 * Клиент написал после закрытия привязанной заявки — вопрос «о ней?» над
 * полем ответа (спека «Chat ↔ ticket»). «Вернуть в работу» открывает карточку
 * заявки сразу с её диалогом возврата (там причина и права), «Новая заявка» —
 * форма заявки из диалога, «Без заявки» закрывает вопрос навсегда для этого
 * закрытия.
 */
const DecisionPrompt = ({
  ticketNum,
  canManage,
  onNewTicket,
  onNoTicket,
}: {
  ticketNum: number;
  canManage: boolean;
  onNewTicket: () => void;
  onNoTicket: () => void;
}) => (
  <HealthRow
    state="warning"
    title={`По заявке №${ticketNum} (закрыта)?`}
    hint="Клиент написал после закрытия заявки"
    className="flex-none"
    action={
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="xs">
          <Link
            to={`/tickets/${ticketNum}`}
            state={{ openAction: "backToWork" }}
          >
            Вернуть в работу
          </Link>
        </Button>
        <Button variant="outline" size="xs" onClick={onNewTicket}>
          Новая заявка
        </Button>
        {canManage && (
          <Button variant="ghost" size="xs" onClick={onNoTicket}>
            Без заявки
          </Button>
        )}
      </div>
    }
  />
);

export default DecisionPrompt;
