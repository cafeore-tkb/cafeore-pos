-- main.go:55 ERROR: function uuid_generate_v4() does not exist (SQLSTATE 42883)
-- [1.933ms] [rows:0] CREATE TABLE "item_types" ("id" uuid DEFAULT uuid_generate_v4(),"name" text NOT NULL,"display_name" text NOT NULL,"deleted" timestamptz,PRIMARY KEY ("id"))
-- panic: ERROR: function uuid_generate_v4() does not exist (SQLSTATE 42883)
-- のエラーが発生するので、DB初回起動時に uuid-ossp 拡張機能を有効化するSQLを実行する
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
