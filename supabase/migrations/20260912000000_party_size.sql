-- 予約に人数を持たせる（docs/spec.md §6「人数」）。
--
-- 定員の意味が「予約件数」から「人数」に変わる。
-- slots.capacity = 2 は「その枠に2名まで受け入れる」であって
-- 「予約を2件まで受ける」ではない。空き枠算出は party_size の和で数える。

alter table bookings add column party_size int not null default 1
  check (party_size between 1 and 2);

comment on column bookings.party_size is '体験に来る人数。定員は件数ではなく人数で数える';
comment on column slots.capacity is '受け入れ人数の上限（予約件数ではない）';
