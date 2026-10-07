-- CaOS：本番の抽出時間をドリッパー・杯数ごとに集計して、係数を出す（Issue #803）。
--
-- caos_drips の 1 行 = 抽出カード 1 枚（1 回のドリップ、最大 2 杯）。抽出が終わったカード
-- （status = 'done'、started_at と finished_at がある）だけを見る。
-- 杯数は明細（lines）の cups の合計。入れ直し（rebrew_of あり）と中断（interrupted）は分けて数える。
-- 係数 = 実際の抽出時間 ÷ 標準の抽出時間（1 杯 135 秒・2 杯 195 秒。CaOS の画面と同じ）。
--
-- 使い方：本番の DB に読み取りでつないで流す（psql "$DATABASE_URL" -f scripts/analytics/caos-brew-stats.sql）。
-- 担当者の名前は、sohosai-shift の割り当て（時間帯ごとの 1st〜6th）と突き合わせて出す（ここでは番号まで）。

with brews as (
  select
    d.day,
    d.dripper,
    (select coalesce(sum((line ->> 'cups')::int), 0) from jsonb_array_elements(d.lines) as line) as cups,
    d.rebrew_of is not null as rebrew,
    d.interrupted,
    extract(epoch from d.finished_at - d.started_at) as seconds,
    -- 日本時間の 30 分ごとの枠（sohosai-shift の割り当てと突き合わせるため）
    date_trunc('hour', d.started_at at time zone 'Asia/Tokyo')
      + floor(extract(minute from d.started_at at time zone 'Asia/Tokyo') / 30) * interval '30 minutes' as slot
  from caos_drips as d
  where d.status = 'done'
    and d.started_at is not null
    and d.finished_at is not null
)

-- ドリッパー・杯数ごと（入れ直し・中断は除く）
select
  day,
  dripper,
  cups,
  count(*) as brews,
  round(avg(seconds)::numeric, 1) as avg_sec,
  round((percentile_cont(0.5) within group (order by seconds))::numeric, 1) as median_sec,
  round(coalesce(stddev_samp(seconds), 0)::numeric, 1) as stddev_sec,
  round((avg(seconds) / case when cups > 1 then 195 else 135 end)::numeric, 2) as coefficient
from brews
where not rebrew and not interrupted
group by day, dripper, cups
order by day, dripper, cups;

-- TODO（Issue #803）
-- - 時間帯（slot）ごと・商品の種類ごとの集計
-- - 入れ直し・中断の件数と、それで余分に使った杯数
-- - sohosai-shift の割り当てと突き合わせて、担当者ごとの係数
