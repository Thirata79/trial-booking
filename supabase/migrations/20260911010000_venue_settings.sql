-- 施設情報の投入（docs/spec.md §2-9 確定分）。
-- T1 のマイグレーションが作った venue_name='TBD' の行を更新する。
--
-- 住所とアクセスは、LINE の確定・リマインド文面にそのまま差し込まれる。
-- 原文「麻布台1－11－5, 港区, Tokyo, 106-0041」「神谷町駅徒歩5分」を、
-- 日本語の案内文として読める形に整えることで合意している。

update settings
set
  venue_name = 'SUPREME LAB',
  venue = jsonb_build_object(
    'address', '〒106-0041 東京都港区麻布台1-11-5',
    'access',  '日比谷線 神谷町駅から徒歩5分',
    'bring',   '着替え'
  )
where id = 1;
