-- アイテムの背景色設定のテーブル。
--
-- 本番は AutoMigrate を走らせない（README の「backend の環境変数」を参照）ので、
-- この SQL を手で流す。中身は models/color_setting.go を AutoMigrate した結果と同じ。
-- IF NOT EXISTS なので、2 回流しても壊れない。

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
