-- psqlで対象cupを設定してから実行する:
-- \set cup_id '対象のcupのUUID'

-- cupの割当て・統合履歴。親order・統合先order/cupを現在の表とJOINする。
-- 現在の注文が削除されていても、履歴と当時の注文番号は残る。
SELECT op.occurred_at, op.recorded_at,
       c.cup_id, c.order_id, c.order_no,
       c.assigned_at, c.merged_at,
       c.before_dripper, c.after_dripper,
       c.merge_target_cup_id, c.merge_target_order_id,
       parent.order_id AS current_parent_order_no,
       target.order_id AS current_target_order_no
FROM caos_operation_cups c
JOIN caos_operations op ON op.id = c.operation_id
LEFT JOIN orders parent ON parent.id = c.order_id
LEFT JOIN orders target ON target.id = c.merge_target_order_id
WHERE c.cup_id = :'cup_id'::uuid
  AND (c.assigned_at IS NOT NULL OR c.merged_at IS NOT NULL)
ORDER BY op.occurred_at, op.id, c.unit_id;

-- 対象cupへの操作と同じ時点で、受付済み・ready前だった別orderのcup。
SELECT op.id AS operation_id, op.occurred_at, op.context_at,
       c.cup_id, c.order_id,
       peer.unit_id AS peer_unit_id, peer.cup_id AS peer_cup_id,
       peer.order_id AS peer_order_id, peer.order_no AS peer_order_no
FROM caos_operation_cups c
JOIN caos_operations op ON op.id = c.operation_id
JOIN caos_operation_cups peer ON peer.operation_id = c.operation_id
WHERE c.cup_id = :'cup_id'::uuid
  AND (c.changed OR c.merged_at IS NOT NULL)
  AND peer.in_window
  AND peer.order_id <> c.order_id
ORDER BY op.occurred_at, op.id, peer.order_no, peer.unit_id;
