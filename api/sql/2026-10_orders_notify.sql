-- 注文が変わったことを api に知らせるトリガー。
--
-- api は orders_changed を LISTEN していて、通知が来るたびに全注文を WebSocket で配り直す
-- （internal/handlers/order_listener.go）。API を通さない書き換え（CaOS が Supabase の RPC で
-- ready_at を付けるなど）も POS の画面に届けるためのもの。
--
-- 本番は AutoMigrate を走らせない（README の「backend の環境変数」を参照）ので、この SQL を手で流す。
-- ローカルで流さなくても、API からの書き換えはこれまでどおり配られる。
-- 何度流しても壊れない。

CREATE OR REPLACE FUNCTION notify_orders_changed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    -- 同じトランザクションの中の同じ通知は Postgres が 1 つにまとめ、コミット時に送る
    PERFORM pg_notify('orders_changed', '');
    RETURN NULL;
END
$$;

CREATE OR REPLACE TRIGGER orders_notify_changed
AFTER INSERT OR UPDATE OR DELETE ON orders
FOR EACH STATEMENT EXECUTE FUNCTION notify_orders_changed();

CREATE OR REPLACE TRIGGER order_menus_notify_changed
AFTER INSERT OR UPDATE OR DELETE ON order_menus
FOR EACH STATEMENT EXECUTE FUNCTION notify_orders_changed();

CREATE OR REPLACE TRIGGER comments_notify_changed
AFTER INSERT OR UPDATE OR DELETE ON comments
FOR EACH STATEMENT EXECUTE FUNCTION notify_orders_changed();
