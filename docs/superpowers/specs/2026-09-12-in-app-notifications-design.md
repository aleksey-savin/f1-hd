# In-app notifications: bell, unread markers, seen tickets — design

Status: approved 2026-09-12 (owner), mockup: artifact «Уведомления в приложении».
Implementation notes: `docs/notifications.md`. UI conventions: `docs/ux-ui-guide.md`.

## Problem

The app notified people only outside itself (e-mail, Telegram). Inside there was
no bell, no unread count, no marker on a ticket row, no line in the chronicle
where the new comments start, and no seen/read state anywhere.

## Decisions

1. **Bell = only what is addressed to me** (my tickets, assignments, help
   requests, comments on my tickets, status and deadline changes, manager events
   for `ticket.manage`, absence and report-approval events). Team-wide awareness
   lives as unread markers in lists and the chronicle, computed from my last
   visit to the ticket. Quiet bell, honest list.
2. **Clients are included**: bell for their categories, markers on the dashboard
   «Заявки» rows, divider in their chronicle.
3. **Two tiers, one mental model**: per-recipient inbox documents
   (`InAppNotification`) for the bell; a per-person watermark (`TicketRead`) plus
   `Ticket.activity {at, by}` for the markers. No per-event documents for tier 2.
4. **Generation stays in the notification cron**, table-driven, one call per job
   before the `switch`; audiences mirror the e-mail branches. Actor excluded,
   service accounts and banned users never recipients, personal gate
   `prefs.notify.personal[category] && user.notify.inApp?.[category] !== false`.
5. **Polling** (15 s summary), no SSE. **No backfill.** Items expire after 90 days.
   No new permission in the dictionary. No global admin switch for the channel.
6. **Settings**: third channel column «Приложение» in the personal matrix, same
   ten category keys, default on.
7. Out of scope: read receipts («seen by»), toast on arrival, tab-title counter,
   per-ticket mute, markers on archive rows, ticket-scope check for managers'
   items (mirrors e-mail today).

## Unread semantics

```
isUnseen    = activity.at && activity.by !== me && (!seenAt || activity.at > seenAt)
newComments = seenAt ? count(comments after seenAt by others) : 0
```

The actor never sees their own action as unread: the ticket page re-marks seen
after every revalidation while visible; the server marks seen after bulk actions,
own comments, ticket creation and staff e-mail replies (bump first, then seen).

## UI (see the mockup)

- Bell in the header right cluster before the theme button (`Button ghost
  icon-xs`, `RiNotification3Line`, primary count pill ringed in the card colour);
  mobile header gets it too, including clients without an avatar.
- Panel: desktop popover 384 px anchored under the bell; mobile bottom sheet
  `h-[92dvh]`. Eyebrow «Уведомления · N» + «Прочитать все»; rows reuse the
  chronicle anatomy (initials tile for comments, tone circle for events); unread
  rows in foreground colour with a dot after the time, read rows muted; footer
  «Показать ещё»; empty «Уведомлений пока нет».
- Ticket rows (staff list and dashboard blocks): primary dot before the number,
  title weight 600, «N новых» in accent text at the start of the meta; nothing on
  read rows; a never-opened ticket shows the dot only.
- Queue chip «Непрочитанные · N» (neutral); «Отметить прочитанными» in the
  toolbar only while that queue is active.
- Chronicle: accent divider «Новые · N» above the block of new comments (replacing
  the «Сегодня» label there) plus a dot after the time on each new comment.
- Wording: «Уведомления», «Прочитать все», «Отметить прочитанными», «Новые»,
  «N новых», «Непрочитанные», «Уведомлений пока нет».
