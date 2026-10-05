-- CaOS（ドリップ管制）の抽出カードの表と、変わったことを api に知らせるトリガー。
--
-- 新しい表はこれだけ。注文の中身（注文番号・商品名など）は持たず、注文と商品の参照と指名・杯数だけを持つ
-- （画面は /api/ws/orders で受け取る注文から引く）。準備完了は既存の注文の API（PATCH /api/orders/{id}/ready）で付ける。
-- 1 つの営業日への処理は、その日の advisory lock で 1 件ずつ順番に行う（ロックのための表は持たない）。
--
-- 配信は注文（2026-10_orders_notify.sql）と同じ：caos_drips が変わるとトリガーが caos_drips_changed を送り、
-- api の各インスタンスが DB から今日のカードを読み直して WebSocket で配る（internal/handlers/order_listener.go）。
--
-- 本番は AutoMigrate を走らせない（README の「backend の環境変数」を参照）ので、この SQL を手で流す。
-- 表は internal/caos/store.go の DripRow を AutoMigrate した結果に、制約と 1 人 1 枚の抽出中の索引を足したもの。
-- 何度流しても壊れない。

-- 抽出カード。1 回のドリップ（最大 2 杯）が 1 行
CREATE TABLE IF NOT EXISTS caos_drips (
    id uuid NOT NULL,
    -- 営業日（日本時間の日付）
    day date NOT NULL,
    -- unassigned：未割当 / queued：担当の待機列 / brewing：抽出中 / done：抽出終了
    status text NOT NULL,
    -- 担当のドリッパー（1〜6）
    dripper smallint,
    -- 待機列の並び順。ふだんは注文番号で、入れ直しのときだけ差し込む位置に合わせる
    queue_pos double precision NOT NULL,
    -- 中身：[{order_id, item_id, nominee, cups}]（統合したカードは 2 注文）。杯数の合計がカードの杯数（1〜2）
    lines jsonb NOT NULL,
    -- 入れ直しのカードなら、元のカード
    rebrew_of uuid,
    -- 入れ直しのために途中でやめた抽出
    interrupted boolean NOT NULL DEFAULT false,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT caos_drips_pkey PRIMARY KEY (id),
    CONSTRAINT caos_drips_status_check CHECK (status IN ('unassigned', 'queued', 'brewing', 'done')),
    CONSTRAINT caos_drips_dripper_check CHECK (dripper BETWEEN 1 AND 6)
);
CREATE INDEX IF NOT EXISTS idx_caos_drips_day ON caos_drips (day);
-- 1 人のドリッパーが同時に抽出できるのは 1 枚だけ（ルールが守っているが、念のため DB でも止める）
CREATE UNIQUE INDEX IF NOT EXISTS caos_drips_one_brewing ON caos_drips (day, dripper) WHERE status = 'brewing';

CREATE OR REPLACE FUNCTION notify_caos_drips_changed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    -- 同じトランザクションの中の同じ通知は Postgres が 1 つにまとめ、コミット時に送る
    PERFORM pg_notify('caos_drips_changed', '');
    RETURN NULL;
END
$$;

CREATE OR REPLACE TRIGGER caos_drips_notify_changed
AFTER INSERT OR UPDATE OR DELETE ON caos_drips
FOR EACH STATEMENT EXECUTE FUNCTION notify_caos_drips_changed();
