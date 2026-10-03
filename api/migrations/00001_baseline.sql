-- 2026-10 時点の本番スキーマ（pg_dump --schema-only）をそのまま写したもの。
--
-- 本番・既存のプレビュー DB には同じテーブルがもうあるので、全部 IF NOT EXISTS にして
-- 何も変えずに「適用済み」として記録されるようにしている。空の DB ではここで全部できる。
--
-- uuid_generate_v4() はスキーマ名を付けない。Supabase では拡張が extensions スキーマに、
-- ローカルや Neon では public に入るが、どちらも search_path で引ける。

-- +goose Up
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS item_types (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    display_name text NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT item_types_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_item_types_deleted_at ON item_types (deleted_at);

CREATE TABLE IF NOT EXISTS items (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    abbr text NOT NULL,
    item_type_id uuid NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT items_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_items_deleted_at ON items (deleted_at);

CREATE TABLE IF NOT EXISTS menus (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    abbr text NOT NULL,
    price bigint NOT NULL,
    key text NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT menus_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_menus_deleted_at ON menus (deleted_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_menus_key ON menus (key);

CREATE TABLE IF NOT EXISTS menu_items (
    menu_id uuid NOT NULL,
    item_id uuid NOT NULL,
    quantity bigint NOT NULL,
    CONSTRAINT menu_items_pkey PRIMARY KEY (menu_id, item_id),
    CONSTRAINT chk_menu_items_quantity CHECK (quantity > 0)
);

CREATE TABLE IF NOT EXISTS orders (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    order_id bigint NOT NULL,
    created_at timestamp with time zone NOT NULL,
    ready_at timestamp with time zone,
    served_at timestamp with time zone,
    billing_amount bigint NOT NULL,
    received bigint NOT NULL,
    discount_order_id bigint,
    discount_order_cups bigint,
    CONSTRAINT orders_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS comments (
    order_id uuid NOT NULL,
    author text NOT NULL,
    text text NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT comments_pkey PRIMARY KEY (order_id, created_at)
);

CREATE TABLE IF NOT EXISTS order_menus (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    order_id uuid NOT NULL,
    menu_id uuid NOT NULL,
    assignee text,
    menu_name text NOT NULL,
    unit_price bigint NOT NULL,
    CONSTRAINT order_menus_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_order_menus_menu_id ON order_menus (menu_id);
CREATE INDEX IF NOT EXISTS idx_order_menus_order_id ON order_menus (order_id);

CREATE TABLE IF NOT EXISTS master_states (
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    type text NOT NULL,
    CONSTRAINT master_states_pkey PRIMARY KEY (created_at)
);

CREATE TABLE IF NOT EXISTS cashier_states (
    id character varying(64) NOT NULL,
    editting_order jsonb NOT NULL,
    submitted_order_id uuid,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT cashier_states_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS stock_resources (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    kind text NOT NULL,
    name text NOT NULL,
    unit text NOT NULL,
    per_serving double precision NOT NULL,
    notify_from bigint NOT NULL,
    notify_step bigint NOT NULL,
    buffer bigint NOT NULL,
    last_alert_threshold bigint,
    deleted_at timestamp with time zone,
    CONSTRAINT stock_resources_pkey PRIMARY KEY (id),
    CONSTRAINT chk_stock_resources_kind CHECK (kind = ANY (ARRAY['cup'::text, 'bean'::text])),
    CONSTRAINT chk_stock_resources_per_serving CHECK (per_serving > (0)::double precision)
);
CREATE INDEX IF NOT EXISTS idx_stock_resources_deleted_at ON stock_resources (deleted_at);

CREATE TABLE IF NOT EXISTS item_stock_usages (
    item_id uuid NOT NULL,
    resource_id uuid NOT NULL,
    amount double precision NOT NULL,
    CONSTRAINT item_stock_usages_pkey PRIMARY KEY (item_id, resource_id),
    CONSTRAINT chk_item_stock_usages_amount CHECK (amount > (0)::double precision)
);

CREATE TABLE IF NOT EXISTS stock_events (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    resource_id uuid NOT NULL,
    kind text NOT NULL,
    quantity double precision NOT NULL,
    note text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT stock_events_pkey PRIMARY KEY (id),
    CONSTRAINT chk_stock_events_kind CHECK (kind = ANY (ARRAY['count'::text, 'receipt'::text, 'adjust'::text]))
);
CREATE INDEX IF NOT EXISTS idx_stock_events_created_at ON stock_events (created_at);
CREATE INDEX IF NOT EXISTS idx_stock_events_resource_id ON stock_events (resource_id);

CREATE TABLE IF NOT EXISTS color_settings (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    target_type text NOT NULL,
    target_id uuid NOT NULL,
    screen text NOT NULL,
    color text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT color_settings_pkey PRIMARY KEY (id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_color_settings_target_screen ON color_settings (target_type, target_id, screen);

-- 基準のスキーマは戻せない（戻すと全テーブルが消える）。黙って成功させず、失敗させる。
-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN RAISE EXCEPTION 'the baseline migration cannot be rolled back'; END $$;
-- +goose StatementEnd
