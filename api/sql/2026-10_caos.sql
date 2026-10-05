-- CaOS（ドリップ管制）の抽出カードと操作の記録の表。
--
-- 表の正本は Go のモデル（internal/caos/store.go の DripRow・OpRow）。この SQL は、AutoMigrate を走らせない本番
-- （README の「backend の環境変数」を参照）に手で流すためのもので、AutoMigrate が作るものと同じ
-- （internal/caos/store_test.go の TestStoreSQLMatchesModels で確かめている）。
-- 本番でも起動時に AutoMigrate するようになったら（#785）、この SQL は要らない。
-- 何度流しても壊れない。DB のトリガーは使わない（変わったことは api が pg_notify で知らせる）。

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

-- 画面からの操作の記録。「1つ戻す」は、画面から送られた中身ではなく、この記録（サーバーが DB から取ったもの）で戻す。
CREATE TABLE IF NOT EXISTS caos_ops (
    id uuid NOT NULL,
    -- 営業日（日本時間の日付）。戻せるのは今日の操作だけ
    day date NOT NULL,
    -- 操作の種類（assign・unassign・next・merge・rebrew）
    name text NOT NULL,
    -- 操作で変わった・消えたカードの、操作の前の中身
    before jsonb NOT NULL,
    -- 操作で変わった・できたカードの、操作の後の中身
    after jsonb NOT NULL,
    -- 操作で準備完了にした注文と、そのとき付けた ready_at：[{order_id, ready_at}]
    readied jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    -- 戻した時刻。同じ操作は 2 回戻せない
    undone_at timestamp with time zone,
    CONSTRAINT caos_ops_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_caos_ops_day ON caos_ops (day);
