-- レジ状態（編集中の注文と直前に確定した注文 ID）のテーブル。
--
-- 本番は AutoMigrate を走らせない（README の「backend の環境変数」を参照）ので、
-- この SQL を手で流す。中身は models/cashier_state.go を AutoMigrate した結果と同じ。
-- IF NOT EXISTS なので、2 回流しても壊れない。

CREATE TABLE IF NOT EXISTS cashier_states (
    id character varying(64) NOT NULL,
    editting_order jsonb NOT NULL,
    submitted_order_id uuid,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT cashier_states_pkey PRIMARY KEY (id)
);
