# CaOSログの実装確認

2026-10-18（日本時間）に、提供された `caos-logs-2026-10-17T16-38-43-498Z.json` と操作実装を照合しました。

## 提供されたログ

端末イベント295件、成功した操作10件、cup履歴57行。

- 01:35:27：`operation.accepted` に「緊急 #008」が1件あります。旧実装では理由・対象cup・生成された入れ直しIDを専用のイベント/成功履歴に残していませんでした。
- 01:36:31：統合 #009 → #008。
- 01:37:12：統合 #011 → #010。
- 統合は2操作、`merged_at` 付きの行は統合元・統合先の計4行。統合元の `merge_target_cup_id` / `merge_target_order_id` と時刻まで保存されています。

以下の追加は今後の操作から有効です。ダウンロード済みJSONや、以前の不足していた履歴を推測で書き換えることはしません。

## 操作とイベントの対応

| CaOSの機能 | 保存する内容・イベント | 主な実装 |
|---|---|---|
| 割当・移動・並べ替え | `board.place.requested`、`operation.*`、送信結果、cupの操作前後・`assigned_at` | `useCaosSession` / `useLiveBoard` / `caos.go` |
| 未割当に戻す・統合解除 | `board.unassign.requested` / `board.split.requested`、書き込み内容・結果・cup履歴 | 同上 |
| 統合（タップ・ドラッグ・緊急後の自動統合） | `board.merge.requested` / `operation.*`、`merge_into`、`merged_at`・統合先cup/order | `mergeWrites` / `useCaosSession` / `caos_log.go` |
| 待機をまとめて移す | `board.move-queue.requested`、書き込み対象・結果。指名で残した杯は盤面差分で照合 | `useCaosSession` |
| 始める・終える・次へ・終了して停止・未着手に戻す | `card.action`、`operation.*`、抽出時刻のcup履歴 | `useCardMenu` / `useCaosSession` / `caos.go` |
| 緊急追加 | `emergency.add.*` と `emergency.api.*`。理由・対象cup/order・生成ID、DBの `emergency.add` と `added=true` | `useCaosSession` / `useCupEmergency` / `cup_emergency.go` |
| 緊急取消 | `emergency.cancel.*`、outboxの成否、DBの `emergency.cancel` と `removed=true`。削除後も理由・元cup/order・入れ直しIDが残る | `useCaosSession` / `cup_emergency.go` |
| 担当者交代・空きにする・次の人へ・入れ替え | `lanes.operation.requested`、outboxの成否。DBの `lanes.change` / `lanes.swap` に変更前後 | `useCaosLanes` / `caos_lanes.go` |
| 上級生属性の名簿同期 | outboxの `seniors`、変更があればDBに `lanes.seniors` | 同上 |
| 交代ダイアログ・予定の設定 | `ui.lane-dialog.changed`、`shift-feed.key.*` / `load.*` / `reload`。合言葉の文字列は含めない | `useCaosLanes` / `useShiftFeed` |
| コメントを表示・閉じる・通知を閉じる | `ui.workspace.changed` / `ui.selection.changed`、`comment.notices.*` | `App` / `useBoardSelection` / `useCommentNotices` |
| スタンプ返信 | `comment.stamp.requested` / `succeeded` / `failed`。order IDとスタンプ、共通actionId | `useStampReply` |
| 豆残量確認の棚卸し・入荷 | `inventory.requested` / `succeeded` / `rejected` / `failed`。在庫対象・数量・結果 | `BeanQueueView` → `StockCard` |
| 緊急シールの印刷・自動再送 | `printer.print.*` / `printer.resend.*`。入れ直しID/未印刷IDと、印刷成功/未印刷キューへの追加 | `useCupEmergency` → `usePrinter` |
| プリンターの手動再接続・再送・接続状態 | `printer.retry` / `printer.state.changed` | `useCaosSession` |
| 未送信操作の再送・破棄・拒否 | `outbox.retry` / `discard` / `send` / `response` / `error` / `rejected` | `useCaosOutbox` |
| 管制盤A/C/D・補助タブ・テスト設定の開閉 | `ui.workspace.changed` / `ui.selection.changed` | `App` / `useBoardSelection` |
| 注文選択・番号検索・カードメニュー・Dの選択 | `ui.selection.changed` / `search.result.changed` / `ui.card-menu.changed` / `ui.unassigned-menu.changed` / `ui.sheet-selection.changed` | 各選択フック |
| ドラッグ・長押し | `gesture.drag.started` / `ended` / `cancelled`、`gesture.hold`。対象とドロップ先・取消を記録 | `useCardDrag` |
| タイムライン移動・現在へ戻る | `ui.workspace.changed` に追従状態と命令、`ui.scroll` にスクロール終了位置 | `App` / `useCaosActivityLog` |
| 早い終了の確認・警告を閉じる・時間切れ | `notice.shown` / `dismissed` / `active.changed`、`confirmation.confirmed` | `useCornerToasts` / `useCaosSession` |
| テストデータ読込・解除 | `practice.import.*`。ファイル名/サイズ・読込件数/問題。ファイル本文は記録しない | `usePracticeData` |
| テスト開始・終了・リセット・一時停止・速度 | `practice.started` / `finished` / `reset` / `running.changed` / `speed.changed` | `useCaosSession` |
| テスト中の割当・統合・次へ・緊急 | `practice.operation.*` / `practice.board.changed` と緊急のmode=practice。実データ用の業務履歴テーブルには混ぜない | `useTestPlay` / `useCaosSession` |
| 通知音ON/OFF | `sound.changed`、閲覧画面は `device-setting.changed` | `useCaosSession` / `useDeviceSetting` |
| 閲覧画面・リベロ・未割当欄の開閉・並び順 | 3画面とも `page.*` / `ui.*`。`device-setting.changed` / `ui.libero-order.changed` | 各route / `useDeviceSetting` / `LiberoBoard` |
| 接続回復・画面開閉・非表示・実行時エラー | `connection.changed` / `page.*`、全イベントに `details.page` | `useLiveBoard` / `useCaosActivityLog` / `log.ts` |

UI操作の記録と、業務操作の成功は別です。クリック・`operation.accepted` は端末での操作/受付、サーバーで通ったことは `outbox.response` と業務履歴で確認します。緊急の直接APIには `emergency.api.*` が付きます。APIの失敗を成功として記録しません。

指の毎フレームの位置・アニメーションの各フレームは保存しません。ドラッグの開始/終了/取消、スクロールの最終位置、実際の状態変化を記録します。入力イベントは残しますが、合言葉・入力欄の文字列は記録しません（注文検索番号、緊急理由、棚卸し数量、スタンプなど、確定した業務操作の内容は記録します）。

## 保存・取得

コンソール出力はありません。端末に残してからDBに送り、`GET /api/caos/logs` と「各種データ書き出し」ページの「ログを保存」（`GET /api/caos/logs/export`）で取得できます。通信不能や保存容量超過、ブラウザデータの消去などでは端末ログが完全には届かない可能性があります。サーバーの成功履歴は盤面/緊急/担当者の更新と同じトランザクションで保存します。

同時間窓のcupはサーバー適用直前のスナップショットです。オフライン中に端末が見ていた盤面の完全な再現とは区別します。

### コメントの記録

- `comment.created`: コメント保存と同一トランザクションでサーバーが記録する成功履歴（export の operations）。details は orderId / orderNo / author / text。マスター以外の投稿も記録する。投稿画面はこの記録だけでは判別できない。既存コメントの遡及追加は行わない。
- `comment.stamp.requested/succeeded/failed`: 画面からの返信試行と結果（entries）。
- `comment.notice.received`: 新着受信。orderId / orderNo / key / shownIn（notification または viewing）。初回読込の既存コメントと返信スタンプは通知対象外。
- `comment.notice.clicked`: 通知の「開く」を押した注文とコメントキー。
- `comment.notices.dismissed`: reason が open なら通知から開く、close なら閉じる。閲覧による自動消去は notices.changed で追える。
- `comment.mark.clicked`: カードのコメント印を押した label / count。
- `search.result.changed`: 注文番号で検索した searched、注文ID、コメント件数・キー、カードキー。番号入力の待機後に記録する。検索結果が更新された場合も記録する。
- `search.submitted`: Enter または検索パネルを閉じて確定した番号と注文ID・コメント件数。
- `search.opened-from-comment`: コメント通知から番号検索を開いた注文番号。

### 人間の操作とシステム処理の区分

GET `/api/caos/logs` と保存JSONの entries / operations に `details.category` を付ける。
- `human`: クリック、キー入力、ドラッグ、返信受付、通知クリック、検索確定など、明示的な操作の記録。
- `system`: API送信・成功・失敗、新着通知受信、状態変化、自動更新など。operations はサーバーの処理成功履歴なので system（コメント保存結果も含む）。
- 既存行も出力時にイベント名から分類する。分類は操作者の認証・本人証明ではない。未知イベントは system。新しいDOMログの isTrusted=false は system。古いDOMログにはこの情報がないためイベント名で推定する。
- scroll は自動スクロールでも発火するため system。状態の changed は原則 system（明示的操作のハンドラー内だけで記録する音設定などを除く）。
- 人間の操作だけを読む場合は entries から `details.category == "human"` を抽出する。処理成功まで追う場合は system の結果ログと operations も参照する。保存先DBのログ自体は削除・抑制しない。

## レジ・準備・提供の成功履歴（運営分析追加後）

- `order.created`: 新しい受注の保存と同じトランザクションで記録。注文ID・番号・カップ数・請求額。冪等キーの再送で重複生成しない。occurred_atは受注時刻、recorded_atはサーバー保存時刻。
- `order.status.changed`: 準備完了・提供・その取消の保存と同じトランザクションで記録。変更したカップだけのready/servedの変更前後を残す。無変更や失敗は成功として残さない。
- 既存のoperationsと同じ保存JSONから取得できる。更新した画面・役割・個人はこの成功履歴だけでは特定しない。既存注文から過去のログを遡及生成しない。全レジ・提供のUIクリック履歴を捕捉するものではない。
