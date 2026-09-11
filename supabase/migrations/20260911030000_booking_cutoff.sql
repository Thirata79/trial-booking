-- 予約締切を「開始の12時間前」から「前日の20:00まで」に変更（docs/spec.md §2-2）。
--
-- 締切の性質が「開始からの相対時間」から「前日の絶対時刻」に変わったため、
-- booking_cutoff_hours（時間数）では表現できない。列を差し替える。
-- remind_hour と同じく「施設のタイムゾーンでの時」を持つ。

alter table settings drop column booking_cutoff_hours;

alter table settings add column booking_cutoff_hour int not null default 20
  check (booking_cutoff_hour between 0 and 23);

comment on column settings.booking_cutoff_hour is
  '前日のこの時刻を過ぎたら、その日の枠は受け付けない（施設のタイムゾーン基準）';
