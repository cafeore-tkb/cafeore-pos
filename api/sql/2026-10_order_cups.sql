-- 注文のカップ（1杯ずつの準備完了・提供済み）のテーブル。#729 で追加した。
--
-- 本番は AutoMigrate を走らせない（README の「backend の環境変数」を参照）ので、
-- この SQL を手で流す。中身は models/order_cup.go を AutoMigrate した結果と同じ
-- （本番の他のテーブルに合わせて外部キーは張らない）。
-- IF NOT EXISTS なので、2 回流しても壊れない。
--
-- これが無いと注文の作成も一覧の取得も 500 になる（order_cups を Preload / INSERT するため）。

CREATE TABLE IF NOT EXISTS order_cups (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    order_id uuid NOT NULL,
    order_menu_id uuid NOT NULL,
    item_id uuid NOT NULL,
    position bigint NOT NULL,
    ready_at timestamp with time zone,
    served_at timestamp with time zone,
    CONSTRAINT order_cups_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_order_cups_order_id ON order_cups (order_id);
CREATE INDEX IF NOT EXISTS idx_order_cups_order_menu_id ON order_cups (order_menu_id);
