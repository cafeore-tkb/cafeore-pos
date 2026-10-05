-- CaOS（ドリップ管制）の盤面の表。
--
-- 盤面は営業日（日本時間）ごとに 1 つ。caos_boards のその日の行をロックして、1 つの盤面への処理を 1 件ずつ順番に行う。
-- カードの作成・抽出終了・注文の ready_at は、POS の注文のハンドラーと同じトランザクションの中で api が書く
-- （internal/caos。DB のトリガーは使わない）。
--
-- 本番は AutoMigrate を走らせない（README の「backend の環境変数」を参照）ので、この SQL を手で流す。
-- 中身は internal/caos/store.go の BoardRow・DripRow を AutoMigrate した結果に、1 人 1 枚の抽出中の索引を足したもの。
-- 何度流しても壊れない。

-- 営業日ごとの盤面の版。カードが変わるたびに 1 ずつ増える（画面は飛んだのに気づいたら読み直す）
CREATE TABLE IF NOT EXISTS caos_boards (
    day date NOT NULL,
    version bigint NOT NULL DEFAULT 0,
    CONSTRAINT caos_boards_pkey PRIMARY KEY (day)
);

-- 抽出カード。1 回のドリップ（最大 2 杯）が 1 行
CREATE TABLE IF NOT EXISTS caos_drips (
    id uuid NOT NULL,
    day date NOT NULL,
    -- unassigned：未割当 / queued：担当の待機列 / brewing：抽出中 / done：抽出終了
    status text NOT NULL,
    -- 担当のドリッパー（1〜6）
    dripper smallint,
    -- 待機列の並び順。ふだんは注文番号で、入れ直しのときだけ差し込む位置に合わせる
    queue_pos double precision NOT NULL,
    -- 中身の注文（統合したカードは 2 注文）と明細。注文番号や商品名はカードを作った時点のものを写す
    order_ids jsonb NOT NULL,
    lines jsonb NOT NULL,
    cups smallint NOT NULL,
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
    CONSTRAINT caos_drips_dripper_check CHECK (dripper BETWEEN 1 AND 6),
    CONSTRAINT caos_drips_cups_check CHECK (cups BETWEEN 1 AND 2)
);
CREATE INDEX IF NOT EXISTS idx_caos_drips_day ON caos_drips (day);
-- 1 人のドリッパーが同時に抽出できるのは 1 枚だけ（ルールが守っているが、念のため DB でも止める）
CREATE UNIQUE INDEX IF NOT EXISTS caos_drips_one_brewing ON caos_drips (day, dripper) WHERE status = 'brewing';
