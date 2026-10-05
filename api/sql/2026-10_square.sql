-- Square Terminal 連携のテーブルと列。
--
-- 本番は AutoMigrate を走らせない（README の「backend の環境変数」を参照）ので、
-- この SQL を手で流す。中身は models/square_checkout.go と models/order.go を
-- AutoMigrate した結果と同じ。IF NOT EXISTS なので、2 回流しても壊れない。

ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method text DEFAULT 'cash' NOT NULL;

CREATE TABLE IF NOT EXISTS square_checkouts (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    idempotency_key text NOT NULL,
    checkout_id text,
    device_id text NOT NULL,
    amount bigint NOT NULL,
    payment_type text NOT NULL,
    status text NOT NULL,
    cancel_reason text,
    payment_ids jsonb DEFAULT '[]' NOT NULL,
    paid_amount bigint,
    error_message text,
    order_number bigint,
    order_id uuid,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT square_checkouts_pkey PRIMARY KEY (id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_square_checkouts_idempotency_key ON square_checkouts (idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_square_checkouts_checkout_id ON square_checkouts (checkout_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_square_checkouts_order_id ON square_checkouts (order_id);
