-- 在庫（カップ・豆の残量）機能のテーブル。
--
-- 本番は AutoMigrate を走らせない（README の「backend の環境変数」を参照）ので、
-- この SQL を手で流す。中身は models/stock.go を AutoMigrate した結果と同じ。

CREATE TABLE stock_resources (
    id uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
    kind text NOT NULL CHECK (kind IN ('cup', 'bean')),
    name text NOT NULL,
    unit text NOT NULL,
    per_serving double precision NOT NULL CHECK (per_serving > 0),
    notify_from bigint NOT NULL,
    notify_step bigint NOT NULL,
    buffer bigint NOT NULL,
    last_alert_threshold bigint,
    deleted_at timestamp with time zone
);
CREATE INDEX idx_stock_resources_deleted_at ON stock_resources (deleted_at);

CREATE TABLE item_stock_usages (
    item_id uuid NOT NULL,
    resource_id uuid NOT NULL,
    amount double precision NOT NULL CHECK (amount > 0),
    PRIMARY KEY (item_id, resource_id)
);

CREATE TABLE stock_events (
    id uuid DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
    resource_id uuid NOT NULL,
    kind text NOT NULL CHECK (kind IN ('count', 'receipt', 'adjust')),
    quantity double precision NOT NULL,
    note text DEFAULT '' NOT NULL,
    created_at timestamp with time zone NOT NULL
);
CREATE INDEX idx_stock_events_created_at ON stock_events (created_at);
CREATE INDEX idx_stock_events_resource_id ON stock_events (resource_id);

-- カップ3種。豆は銘柄ごとに POS の /inventory/settings から足す。
INSERT INTO stock_resources (kind, name, unit, per_serving, notify_from, notify_step, buffer) VALUES
    ('cup', 'ホットカップ', '個', 1, 500, 100, 100),
    ('cup', 'アイスカップ', '個', 1, 500, 100, 100),
    ('cup', 'オレカップ',   '個', 1, 500, 100, 100);
