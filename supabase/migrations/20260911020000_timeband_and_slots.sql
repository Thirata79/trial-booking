-- 体験枠の確定（docs/spec.md §2-1）と、それに伴う timeband の整理。
--
-- 決まった内容：月〜日、12:00 / 14:00 / 16:00、各60分、定員2名。
--
-- 枠がすべて午後になったため、§5 の当初の timeband
-- （weekday_am / weekday_pm / weekend_am）では土日の枠を表現できない。
-- 実態に合わせて「平日午後 / 週末午後」の2種に整理する。
-- 使わない午前の区分は残さない（§0-3「先回りして抽象化しない」）。

alter table slots drop constraint slots_timeband_check;
alter table slots add constraint slots_timeband_check
  check (timeband in ('weekday_pm','weekend_pm'));

-- 月〜日 × 12:00 / 14:00 / 16:00 = 21枠。weekday は 0=Sun。
insert into slots (weekday, start_time, duration_min, capacity, timeband, active)
select
  d.weekday,
  t.start_time,
  60,
  2,
  case when d.weekday between 1 and 5 then 'weekday_pm' else 'weekend_pm' end,
  true
from generate_series(0, 6) as d(weekday)
cross join (values (time '12:00'), (time '14:00'), (time '16:00')) as t(start_time);
