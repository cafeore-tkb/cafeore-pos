-- 注文が変わったことを api に知らせるトリガー。
--
-- api は orders_changed を LISTEN していて、通知に載った注文 ID の注文を読み直して WebSocket で配る
-- （internal/handlers/order_listener.go）。API を通さない書き換え（SQL で直接直すなど）や、
-- ほかのインスタンスでの書き換えも POS の画面に届けるためのもの。
--
-- 本番は AutoMigrate を走らせない（README の「backend の環境変数」を参照）ので、この SQL を手で流す。
-- ローカルで流さなくても、API からの書き換えはこれまでどおり配られる。
-- 何度流しても壊れない（以前の、文ごとに空の通知を送る版も置き換える）。

CREATE OR REPLACE FUNCTION notify_orders_changed() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    changed uuid;
BEGIN
    IF TG_TABLE_NAME = 'orders' THEN
        changed := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
    ELSE
        changed := CASE WHEN TG_OP = 'DELETE' THEN OLD.order_id ELSE NEW.order_id END;
    END IF;
    -- 同じトランザクションの中の同じ通知（チャンネルと注文 ID が同じもの）は Postgres が 1 つにまとめ、
    -- コミット時に送る。カップを何杯書き換えても、注文 1 件につき通知は 1 つ。
    PERFORM pg_notify('orders_changed', changed::text);
    RETURN NULL;
END
$$;

CREATE OR REPLACE TRIGGER orders_notify_changed
AFTER INSERT OR UPDATE OR DELETE ON orders
FOR EACH ROW EXECUTE FUNCTION notify_orders_changed();

CREATE OR REPLACE TRIGGER order_menus_notify_changed
AFTER INSERT OR UPDATE OR DELETE ON order_menus
FOR EACH ROW EXECUTE FUNCTION notify_orders_changed();

CREATE OR REPLACE TRIGGER order_cups_notify_changed
AFTER INSERT OR UPDATE OR DELETE ON order_cups
FOR EACH ROW EXECUTE FUNCTION notify_orders_changed();

CREATE OR REPLACE TRIGGER comments_notify_changed
AFTER INSERT OR UPDATE OR DELETE ON comments
FOR EACH ROW EXECUTE FUNCTION notify_orders_changed();
