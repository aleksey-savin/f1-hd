import { RiTimeLine } from "react-icons/ri";

import { Button } from "@/components/ui/button";

// Своя заявка, ждущая решения, — отдельной строкой перед чужими.
//
// В общей плашке «N запросов ждут решения» она терялась: там перечислены все,
// и своя ничем не отличалась. Тон здесь не предупреждающий, а «наш»: чужая
// заявка — работа, которую надо сделать, своя — просто ожидание. «Отозвать»
// живёт тут же, потому что отзывать имеет смысл ровно пока заявка висит.

type PendingAbsence = {
  _id: string;
  typeLabel: string;
  from: string;
  to: string;
  comment?: string;
};

const humanDate = (key: string) => key.split("-").reverse().join(".");

const range = (from: string, to: string) =>
  from === to ? humanDate(from) : `${humanDate(from)} — ${humanDate(to)}`;

const MyPendingRow = ({
  absence,
  busy,
  onCancel,
}: {
  absence: PendingAbsence;
  busy: boolean;
  onCancel: (id: string) => void;
}) => (
  <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5 rounded-xl border border-primary/45 bg-primary/[0.09] px-4 py-3 text-sm">
    <RiTimeLine className="flex-none text-accent-text" size={17} />
    <span className="min-w-0 flex-1">
      <b className="font-semibold">Ваша заявка ждёт решения</b>
      <span className="block text-xs text-muted-foreground">
        {absence.typeLabel} · {range(absence.from, absence.to)}
        {absence.comment ? ` · «${absence.comment}»` : ""}
      </span>
    </span>
    <Button
      variant="outline"
      size="sm"
      disabled={busy}
      onClick={() => onCancel(absence._id)}
    >
      Отозвать
    </Button>
  </div>
);

export default MyPendingRow;
