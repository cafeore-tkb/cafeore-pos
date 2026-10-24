package handlers

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"slices"
	"strings"
	"time"

	"cafeore-pos/api/internal/auth"
	"cafeore-pos/api/internal/models"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"gorm.io/gorm"
)

// 営業データのリセット（/api/admin/data-reset）。管理者だけが使える（routes.go で auth.RequireStrict(auth.RoleAdmin)）。
//
// 消すのは営業中に溜まるもの（注文・CaOS の記録・Square の決済の記録・棚卸しと入荷の記録・受付状態の履歴など）だけで、
// メニュー・アイテム・在庫対象・色・プリンター・Square 端末の設定は残す。表の中身を消すだけで、DB のユーザーや
// スキーマには触らない（DB のユーザーを作り直す必要は無い）。
//
// 消す前に次を確かめる。どれか 1 つでも満たさなければ、何も消さない。
//   - 受付を止めている（オーダーストップの最後の記録が stop）
//   - 消す表の今の中身を全部ダウンロードしている（ダウンロードしたバックアップの SHA-256 が、
//     消す直前に同じ形で作り直したものと一致する。ダウンロードのあとに 1 行でも変われば一致しない）
//   - 確認の文字（dataResetConfirmation）を打っている
//   - 消す表にも残す表にも入っていない表が DB に無い（モデルを足したのにここを直していない、など）

// 消すときに打ってもらう確認の文字。
const dataResetConfirmation = "リセット"

// 消す表。この順でバックアップに書く。
//
// 表を足したら（models.All に足したら）、ここか dataResetKeptTables のどちらかに足すこと。
// どちらにも無い表があると、リセットは何も消さずに断る（TestDataResetTablesCoverModels でも確かめる）。
var dataResetTables = []string{
	"orders", "order_menus", "order_cups", "order_payments", "comments",
	"cup_emergencies", "order_stock_usages", "cup_emergency_stock_usages",
	"caos_client_logs", "caos_operations", "caos_operation_cups",
	"square_checkouts", "square_actions", "label_print_requests",
	"cashier_states", "master_states", "stock_events",
	"dripper_assignees", "dripper_assignee_changes",
}

// 残す表（設定）。在庫対象（stock_resources）は、最後に通知した段階（last_alert_threshold）だけ空に戻す。
var dataResetKeptTables = []string{
	"item_types", "items", "menus", "menu_items",
	"stock_resources", "stock_resource_item_types",
	"color_settings", "printer_settings", "square_devices",
}

// 消す前の表のロックを待つ長さ。営業中の書き込みが残っていても、いつまでも止まらないように。
const dataResetLockTimeout = "10s"

// リセット全体（ロックを取ってから消し終わるまで）にかけてよい長さ。消す表を全部ロックしたまま
// バックアップを作り直して比べるので、その間はほかのインスタンスもその表を読み書きできない。
// 超えたら問い合わせを取り消してロールバックし（ロックも外れる）、何も消さない。
//
// lock_timeout はロックを取るまでの待ちにしか、statement_timeout は 1 文ごとにしか効かないので、
// トランザクション全体の締め切りは context で付ける（statement_timeout は DB 側の念のため）。
// テストで短くするため変数にしている。
var dataResetTimeout = 60 * time.Second

// リセットを断った理由。errors.As で応答の形に振り分ける。
type dataResetRefusal struct {
	status  int
	message string
}

func (e *dataResetRefusal) Error() string { return e.message }

type DataResetHandler struct {
	db  *gorm.DB
	hub *Hub
}

func NewDataResetHandler(db *gorm.DB, hub *Hub) *DataResetHandler {
	return &DataResetHandler{db: db, hub: hub}
}

// GET /api/admin/data-reset - 消す表と行数・受付を止めているか
func (h *DataResetHandler) GetDataResetStatus(c *gin.Context) {
	var status models.DataResetStatus
	err := h.db.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var err error
		if status.UnknownTables, err = unknownDataResetTables(tx); err != nil {
			return err
		}
		if status.ReceptionStopped, err = receptionStopped(tx); err != nil {
			return err
		}
		status.Tables, err = countDataResetTables(tx)
		return err
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		log.Printf("failed to read data reset status: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "状態を読めませんでした"})
		return
	}
	status.KeptTables = dataResetKeptTables
	status.Confirmation = dataResetConfirmation
	c.JSON(http.StatusOK, status)
}

// GET /api/admin/data-reset/backup - 消す表の全行を JSON で書き出す
//
// 書き出しは一時ファイルに置いてから返す（CaOS のログの書き出しと同じ）。途中で DB を読めなくなったときに、
// 半端なファイルを 200 で返さないため。
//
// 返すときは Content-Length を付けずに流す（chunked）。Cloud Run は HTTP/1 の応答を、chunked でなければ
// 32 MiB までしか返せない。CaOS の端末のログは営業の間に大きくなりうる。
func (h *DataResetHandler) ExportDataResetBackup(c *gin.Context) {
	file, err := os.CreateTemp("", "data-reset-backup-*.json")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "書き出しファイルを作成できませんでした"})
		return
	}
	defer func() {
		// 応答後の一時ファイルの後始末。失敗しても送信済みの応答は変更できない。
		_ = file.Close()
		_ = os.Remove(file.Name())
	}()
	now := time.Now().UTC()
	err = h.db.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		return writeDataResetBackup(tx, file)
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		log.Printf("failed to export data reset backup: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "バックアップを書き出せませんでした"})
		return
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "書き出しファイルを読めませんでした"})
		return
	}
	name := "cafeore-pos-backup-" + now.Format("20060102-150405") + ".json"
	c.Header("Content-Type", "application/json; charset=utf-8")
	c.Header("Content-Disposition", `attachment; filename="`+name+`"`)
	c.Status(http.StatusOK)
	if _, err := io.Copy(c.Writer, file); err != nil {
		// もう 200 を返し始めているので、ログに残すだけ。画面は本文が途中で切れて失敗する
		log.Printf("failed to send data reset backup: %v", err)
	}
}

// POST /api/admin/data-reset - 営業データを消す
func (h *DataResetHandler) ResetData(c *gin.Context) {
	var req models.DataResetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Confirmation != dataResetConfirmation {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("確認の文字が違います。「%s」と入力してください", dataResetConfirmation)})
		return
	}
	backupSHA256 := strings.ToLower(strings.TrimSpace(req.BackupSha256))
	if len(backupSHA256) != sha256.Size*2 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "バックアップの SHA-256 がありません。先にバックアップをダウンロードしてください"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), dataResetTimeout)
	defer cancel()
	var deleted []models.DataResetTable
	err := h.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var err error
		deleted, err = resetData(tx, backupSHA256)
		return err
	})
	var refusal *dataResetRefusal
	switch {
	case errors.As(err, &refusal):
		c.JSON(refusal.status, gin.H{"error": refusal.message})
		return
	case err != nil && errors.Is(ctx.Err(), context.DeadlineExceeded):
		log.Printf("data reset timed out after %s: %v", dataResetTimeout, err)
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": fmt.Sprintf("%s 以内に確かめきれなかったので、何も消していません。データが多すぎる可能性があります", dataResetTimeout)})
		return
	case err != nil:
		log.Printf("failed to reset data: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "消せませんでした。何も消していません"})
		return
	}

	log.Printf("data reset by %s: %s", dataResetActor(c), formatDataResetTables(deleted))
	publishDataReset(h.db, h.hub)
	c.JSON(http.StatusOK, models.DataResetResult{Tables: deleted})
}

// 確かめてから消す。tx の中で呼ぶこと。消した表と、消す前の行数を返す。
func resetData(tx *gorm.DB, backupSHA256 string) ([]models.DataResetTable, error) {
	if err := tx.Exec("SET LOCAL lock_timeout = '" + dataResetLockTimeout + "'").Error; err != nil {
		return nil, err
	}
	if err := tx.Exec(fmt.Sprintf("SET LOCAL statement_timeout = %d", dataResetTimeout.Milliseconds())).Error; err != nil {
		return nil, err
	}
	// 確かめてから消すまでの間に書き込まれないよう、消す表を先に全部ロックする（読むのも待たせる）
	if err := tx.Exec("LOCK TABLE " + quoteDataResetTables() + " IN ACCESS EXCLUSIVE MODE").Error; err != nil {
		return nil, err
	}

	unknown, err := unknownDataResetTables(tx)
	if err != nil {
		return nil, err
	}
	if len(unknown) > 0 {
		return nil, &dataResetRefusal{http.StatusConflict, "消すか残すか決めていない表があるので、何も消していません: " + strings.Join(unknown, ", ")}
	}

	stopped, err := receptionStopped(tx)
	if err != nil {
		return nil, err
	}
	if !stopped {
		return nil, &dataResetRefusal{http.StatusConflict, "受付を止めてから消してください（マスターでオーダーストップ）"}
	}

	hash := sha256.New()
	if err := writeDataResetBackup(tx, hash); err != nil {
		return nil, err
	}
	if hex.EncodeToString(hash.Sum(nil)) != backupSHA256 {
		return nil, &dataResetRefusal{http.StatusConflict, "ダウンロードしたあとにデータが変わりました（開いている端末が書き込んだかもしれません）。もう一度バックアップをダウンロードしてから消してください"}
	}

	counts, err := countDataResetTables(tx)
	if err != nil {
		return nil, err
	}
	if err := tx.Exec("TRUNCATE TABLE " + quoteDataResetTables() + " RESTART IDENTITY").Error; err != nil {
		return nil, err
	}
	// 在庫対象は残すが、最後に通知した段階は消した注文で減った残量のものなので戻す
	if err := tx.Exec("UPDATE stock_resources SET last_alert_threshold = NULL").Error; err != nil {
		return nil, err
	}
	return counts, nil
}

// 消す表の全行を書く。同じ中身なら同じバイト列になるよう、表は dataResetTables の順、行は行全体の文字列のバイト順に並べ、
// 時刻は UTC で書く（どの行も主キーがあるので、行全体の文字列は重ならない）。
func writeDataResetBackup(tx *gorm.DB, w io.Writer) error {
	if err := tx.Exec("SET LOCAL TimeZone = 'UTC'").Error; err != nil {
		return err
	}
	if _, err := fmt.Fprintf(w, `{"format":%q,"version":%d,"tables":{`, models.DataResetBackupFormatV1, models.DataResetBackupVersion1); err != nil {
		return err
	}
	for i, table := range dataResetTables {
		if i > 0 {
			if _, err := io.WriteString(w, ","); err != nil {
				return err
			}
		}
		if _, err := fmt.Fprintf(w, "%q:[", table); err != nil {
			return err
		}
		if err := writeDataResetRows(tx, w, table); err != nil {
			return fmt.Errorf("%s: %w", table, err)
		}
		if _, err := io.WriteString(w, "]"); err != nil {
			return err
		}
	}
	_, err := io.WriteString(w, "}}\n")
	return err
}

func writeDataResetRows(tx *gorm.DB, w io.Writer, table string) error {
	rows, err := tx.Raw(`SELECT row_to_json(t)::text FROM ` + pgx.Identifier{table}.Sanitize() + ` t ORDER BY t::text COLLATE "C"`).Rows()
	if err != nil {
		return err
	}
	defer func() { _ = rows.Close() }()
	first := true
	for rows.Next() {
		var row string
		if err := rows.Scan(&row); err != nil {
			return err
		}
		if !first {
			if _, err := io.WriteString(w, ","); err != nil {
				return err
			}
		}
		first = false
		if _, err := io.WriteString(w, row); err != nil {
			return err
		}
	}
	return rows.Err()
}

// 消す表の今の行数。
func countDataResetTables(tx *gorm.DB) ([]models.DataResetTable, error) {
	tables := make([]models.DataResetTable, 0, len(dataResetTables))
	for _, table := range dataResetTables {
		var n int64
		if err := tx.Raw("SELECT count(*) FROM " + pgx.Identifier{table}.Sanitize()).Scan(&n).Error; err != nil {
			return nil, fmt.Errorf("%s: %w", table, err)
		}
		tables = append(tables, models.DataResetTable{Name: table, Rows: n})
	}
	return tables, nil
}

// DB にあって、消す表にも残す表にも入っていない表。
func unknownDataResetTables(tx *gorm.DB) ([]string, error) {
	var names []string
	if err := tx.Raw(`SELECT table_name FROM information_schema.tables
		WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'
		ORDER BY table_name`).Scan(&names).Error; err != nil {
		return nil, err
	}
	unknown := []string{}
	for _, name := range names {
		if !slices.Contains(dataResetTables, name) && !slices.Contains(dataResetKeptTables, name) {
			unknown = append(unknown, name)
		}
	}
	return unknown, nil
}

// 受付を止めているか。オーダーストップの記録が無ければ止めていない。
func receptionStopped(tx *gorm.DB) (bool, error) {
	var state models.MasterState
	err := tx.Order("created_at DESC").First(&state).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return state.Type == string(models.Stop), nil
}

func quoteDataResetTables() string {
	quoted := make([]string, len(dataResetTables))
	for i, table := range dataResetTables {
		quoted[i] = pgx.Identifier{table}.Sanitize()
	}
	return strings.Join(quoted, ", ")
}

// 誰が消したか（ログに残す）。
func dataResetActor(c *gin.Context) string {
	if v, ok := c.Get(auth.IdentityContextKey); ok {
		if identity, ok := v.(auth.AccessIdentity); ok {
			return identity.Name()
		}
	}
	return "unknown"
}

func formatDataResetTables(tables []models.DataResetTable) string {
	parts := make([]string, len(tables))
	for i, t := range tables {
		parts[i] = fmt.Sprintf("%s=%d", t.Name, t.Rows)
	}
	return strings.Join(parts, " ")
}

// 消したことを、このインスタンスにつないでいる画面へ配り、ほかのインスタンスにも DB の通知で知らせる。
// 画面は data_reset を受けたら読み込み直す（手元に持っている注文や受付の状態を捨てる）。
func publishDataReset(db *gorm.DB, hub *Hub) {
	broadcastDataReset(hub)
	notifyChanged(db, dataResetChannel, instanceID)
}

func broadcastDataReset(hub *Hub) {
	_ = hub.Publish(func() (WSMessage, error) {
		return WSMessage{Type: WSMessageTypeDataReset}, nil
	})
}
