import { Eyebrow, Panel } from "@/components/app/Panel";
import { displayTimeZone } from "@/util/format-date";
import { stampLabel } from "@/util/mikrotik-changes";

// Панель «Хроника»: время и фраза, текст приходит с сервера готовым
const ChangeTimeline = ({ timeline = [] }) => {
  const timeZone = displayTimeZone();
  return (
    <>
      <Eyebrow>Хроника</Eyebrow>
      <Panel>
        <ol className="m-0 grid list-none grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 p-0 text-sm">
          {timeline.map((entry, index) => (
            <li key={index} className="contents">
              <time
                dateTime={entry.at}
                className="text-xs leading-5 whitespace-nowrap text-faint tabular-nums"
              >
                {stampLabel(entry.at, { timeZone })}
              </time>
              <span className="wrap-anywhere">{entry.text}</span>
            </li>
          ))}
        </ol>
      </Panel>
    </>
  );
};

export default ChangeTimeline;
