-- 予約締切とリマインド時刻の確定（docs/spec.md §2-2, §2-4）。
--   予約締切   ：前日の18:00まで
--   リマインド ：前日の19:00
--
-- 締切の性質が「開始からの相対時間」から「前日の絶対時刻」に変わったため、
-- booking_cutoff_hours（時間数）では表現できない。列を差し替える。
-- remind_hour と同じく「施設のタイムゾーンでの時」を持つ。
--
-- 締切(18:00) がリマインド(19:00) より先に来るので、前日リマインドの対象から
-- 漏れる予約は発生しない。

alter table settings drop column booking_cutoff_hours;

alter table settings add column booking_cutoff_hour int not null default 18
  check (booking_cutoff_hour between 0 and 23);

comment on column settings.booking_cutoff_hour is
  '前日のこの時刻を過ぎたら、その日の枠は受け付けない（施設のタイムゾーン基準）';

-- リマインドを締切の1時間後にずらす（T1 の既定は 18）。
alter table settings alter column remind_hour set default 19;
update settings set remind_hour = 19 where id = 1;
