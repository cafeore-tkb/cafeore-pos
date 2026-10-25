package handlers

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"cafeore-pos/api/internal/models"
)

// LabelPrintHandler は代理印刷。端末（CaOS・マスターの緊急）がラベル用のプリンターに直接刷れなかったシールを、
// 代理印刷をオンにしたレジに刷ってもらう（models.LabelPrintRequest）。
//
// サーバーはプリンターにつながず、頼みを持っておいて配るだけ。刷るのはレジのブラウザで、刷る前に引き受け（claim）、
// 引き受けたレジだけが刷る（代理印刷のレジが何台あっても 1 枚だけ刷る）。
type LabelPrintHandler struct {
	db  *gorm.DB
	hub *Hub
	now func() time.Time
}

func NewLabelPrintHandler(db *gorm.DB, hub *Hub) *LabelPrintHandler {
	return &LabelPrintHandler{db: db, hub: hub, now: time.Now}
}

const (
	// 引き受けが切れるまでの長さ。レジがラベル用のプリンターの返事を待つ長さ（50 秒。画面の infra/epos.ts）より長くする
	labelPrintClaimTTL = 60 * time.Second
	// 印刷データ（JSON）の大きさの上限。緊急のシールは、緊急の画像（360 × 232 ドットで 14 KiB ほど）を含めて 15 KiB ほど
	labelPrintJobMaxBytes = 64 * 1024
	// 刷るレジの id の長さ（文字。OpenAPI の maxLength と同じ）
	labelPrintDeviceMax = 64
)

// POST /api/label-print-requests - 緊急（淹れ直し）のシールをレジに代わりに刷ってもらう。id は淹れ直しの id。
// 同じ id は 1 つだけで、2 回目からは中身を変えない。まだ刷れていなければ、代理印刷のレジへ配る（2 回目からは配り直す）。
// 淹れ直しが無い（取り消した・注文の編集や削除で消えた）なら 410 で、頼みは作らない。消えた淹れ直しは戻らないので、
// 頼んだ端末はそのシールを捨てる（ルートが無い 404 と見分けるため 404 にはしない。404 なら端末は頼み直す）。
func (h *LabelPrintHandler) CreateLabelPrintRequest(c *gin.Context) {
	// 本文は印刷データと id だけなので、印刷データの上限に少し足した分まで読む
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, labelPrintJobMaxBytes+1024)
	var req models.LabelPrintRequestCreateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	id := uuid.UUID(req.Id)
	if id == uuid.Nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id がありません"})
		return
	}
	if len(req.Job.Labels) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "job.labels は空にしないでください"})
		return
	}
	job, err := json.Marshal(req.Job)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if len(job) > labelPrintJobMaxBytes {
		c.JSON(http.StatusBadRequest, gin.H{"error": "印刷データが大きすぎます"})
		return
	}
	row := models.LabelPrintRequest{ID: id, Job: models.JSONB(job), CreatedAt: h.now()}
	err = h.db.Transaction(func(tx *gorm.DB) error {
		// 淹れ直しの行を FOR SHARE で読んでから足す。淹れ直しを消すとき（cup_emergency.go の deleteCupEmergencies）は淹れ直しの行を
		// 消してから頼みを消すので、消すのが先なら行が無くて 410、こちらが先なら消すときにこの頼みも消す（消えた緊急のシールを刷らない）
		if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).Select("id").
			First(&models.CupEmergency{}, "id = ?", id).Error; err != nil {
			return err
		}
		// 送り直し（返事が届かなかった）なら、受け取った頼みのまま
		return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error
	})
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusGone, gin.H{"error": "緊急（淹れ直し）が見つかりません（取り消したか、注文が編集・削除されたかもしれません）"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
	c.Writer.WriteHeaderNow()
	publishLabelPrintRequested(h.db, h.hub, id)
}

// GET /api/label-print-requests - 今日（日本時間）頼まれて、まだ刷れていない代理印刷（古い順）。刷っている途中のものも入る。
func (h *LabelPrintHandler) GetLabelPrintRequests(c *gin.Context) {
	start, end := caosToday(h.now())
	var rows []models.LabelPrintRequest
	if err := h.db.Where("printed_at IS NULL AND created_at >= ? AND created_at < ?", start, end).
		Order("created_at, id").Find(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	resp := make([]models.LabelPrintRequestResponse, 0, len(rows))
	for i := range rows {
		r, err := toLabelPrintRequestResponse(&rows[i])
		if err != nil {
			// 読めない印刷データはレジも刷れないので、ほかのものだけ返す
			log.Printf("failed to read label print request %s: %v", rows[i].ID, err)
			continue
		}
		resp = append(resp, r)
	}
	c.JSON(http.StatusOK, resp)
}

// POST /api/label-print-requests/{id}/claim - 代理印刷のレジが、刷る前に引き受ける。
// 刷れていなくて、ほかのレジが引き受けていない（引き受けが切れた）か同じレジなら、labelPrintClaimTTL のあいだ引き受ける。
func (h *LabelPrintHandler) ClaimLabelPrintRequest(c *gin.Context) {
	id, ok := parseUUIDParam(c)
	if !ok {
		return
	}
	device, ok := bindLabelPrintDevice(c)
	if !ok {
		return
	}
	var resp models.LabelPrintClaimResponse
	err := h.db.Transaction(func(tx *gorm.DB) error {
		// 同時に引き受けようとしたレジは、先のレジが書き終えるまで待ってから読む（2 台が引き受けないように）
		var row models.LabelPrintRequest
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&row, "id = ?", id).Error; err != nil {
			return err
		}
		now := h.now()
		switch {
		case row.PrintedAt != nil:
			resp = models.LabelPrintClaimResponse{Status: models.Printed}
			return nil
		case row.ClaimedBy != nil && *row.ClaimedBy != device && row.ClaimedUntil != nil && row.ClaimedUntil.After(now):
			resp = models.LabelPrintClaimResponse{Status: models.Busy}
			return nil
		}
		if err := tx.Model(&models.LabelPrintRequest{}).Where("id = ?", id).
			Updates(map[string]any{"claimed_by": device, "claimed_until": now.Add(labelPrintClaimTTL)}).Error; err != nil {
			return err
		}
		job, err := toLabelPrintJob(row.Job)
		if err != nil {
			return err
		}
		resp = models.LabelPrintClaimResponse{Status: models.Claimed, Job: &job}
		return nil
	})
	if respondLabelPrintError(c, err) {
		return
	}
	c.JSON(http.StatusOK, resp)
}

// POST /api/label-print-requests/{id}/printed - 引き受けたレジが刷れた。刷れたことにして全部の画面に知らせる。
// 何度呼んでもよい（知らせるのは初めて刷れたことにしたときだけ）。引き受けが切れた後でも、刷れたことにする。
func (h *LabelPrintHandler) MarkLabelPrintRequestPrinted(c *gin.Context) {
	id, ok := parseUUIDParam(c)
	if !ok {
		return
	}
	device, ok := bindLabelPrintDevice(c)
	if !ok {
		return
	}
	result := h.db.Model(&models.LabelPrintRequest{}).Where("id = ? AND printed_at IS NULL", id).
		Updates(map[string]any{"printed_at": h.now(), "printed_by": device, "claimed_by": nil, "claimed_until": nil})
	if respondLabelPrintError(c, result.Error) {
		return
	}
	if result.RowsAffected == 0 {
		if respondLabelPrintError(c, h.ensureExists(id)) {
			return
		}
		c.Status(http.StatusNoContent)
		return
	}
	c.Status(http.StatusNoContent)
	c.Writer.WriteHeaderNow()
	publishLabelPrintDone(h.db, h.hub, id)
}

// POST /api/label-print-requests/{id}/release - 引き受けたレジが刷れなかった。そのレジが引き受けていれば引き受けをやめ、
// ほかの代理印刷のレジが引き受けられるよう配り直す。
func (h *LabelPrintHandler) ReleaseLabelPrintRequest(c *gin.Context) {
	id, ok := parseUUIDParam(c)
	if !ok {
		return
	}
	device, ok := bindLabelPrintDevice(c)
	if !ok {
		return
	}
	result := h.db.Model(&models.LabelPrintRequest{}).Where("id = ? AND printed_at IS NULL AND claimed_by = ?", id, device).
		Updates(map[string]any{"claimed_by": nil, "claimed_until": nil})
	if respondLabelPrintError(c, result.Error) {
		return
	}
	if result.RowsAffected == 0 {
		if respondLabelPrintError(c, h.ensureExists(id)) {
			return
		}
		c.Status(http.StatusNoContent)
		return
	}
	c.Status(http.StatusNoContent)
	c.Writer.WriteHeaderNow()
	publishLabelPrintRequested(h.db, h.hub, id)
}

// 頼みがあるか。無ければ gorm.ErrRecordNotFound
func (h *LabelPrintHandler) ensureExists(id uuid.UUID) error {
	var count int64
	if err := h.db.Model(&models.LabelPrintRequest{}).Where("id = ?", id).Count(&count).Error; err != nil {
		return err
	}
	if count == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

// 刷るレジの id を読む。読めなければ 400 を書いて false
func bindLabelPrintDevice(c *gin.Context) (string, bool) {
	var req models.LabelPrintDeviceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return "", false
	}
	device := strings.TrimSpace(req.DeviceId)
	if device == "" || utf8.RuneCountInString(device) > labelPrintDeviceMax {
		c.JSON(http.StatusBadRequest, gin.H{"error": "device_id は 1〜64 文字にしてください"})
		return "", false
	}
	return device, true
}

// 頼みが無ければ 404（緊急を取り消すと消える）、ほかは respondError と同じ。書いたら true
func respondLabelPrintError(c *gin.Context, err error) bool {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "代理印刷の頼みが見つかりません（緊急を取り消したかもしれません）"})
		return true
	}
	return respondError(c, err)
}

func toLabelPrintJob(raw models.JSONB) (models.LabelPrintJob, error) {
	var job models.LabelPrintJob
	err := json.Unmarshal(raw, &job)
	return job, err
}

func toLabelPrintRequestResponse(row *models.LabelPrintRequest) (models.LabelPrintRequestResponse, error) {
	job, err := toLabelPrintJob(row.Job)
	if err != nil {
		return models.LabelPrintRequestResponse{}, err
	}
	return models.LabelPrintRequestResponse{Id: row.ID, Job: job, CreatedAt: row.CreatedAt}, nil
}

// publishLabelPrintRequested は頼みを、このインスタンスの画面へ配り、ほかのインスタンスへ DB の通知で知らせる。
// 受け損ねたレジは、つなぎ直したときと一定の間隔で GET /api/label-print-requests を読んで追いつく。
func publishLabelPrintRequested(db *gorm.DB, hub *Hub, id uuid.UUID) {
	broadcastLabelPrintRequested(db, hub, id)
	notifyChanged(db, labelPrintRequestedChannel, instanceID+" "+id.String())
}

// broadcastLabelPrintRequested は頼みを DB から読み直し、まだ刷れていなければ、このインスタンスの画面へだけ配る
// （ほかのインスタンスからの通知でも使う）。刷れたという知らせ（publishLabelPrintDone）と入れ違わないよう、読み込みから配信までを Publish で行う。
func broadcastLabelPrintRequested(db *gorm.DB, hub *Hub, id uuid.UUID) {
	err := hub.Publish(func() (WSMessage, error) {
		var row models.LabelPrintRequest
		if err := db.First(&row, "id = ? AND printed_at IS NULL", id).Error; err != nil {
			return WSMessage{}, err
		}
		resp, err := toLabelPrintRequestResponse(&row)
		if err != nil {
			return WSMessage{}, err
		}
		return WSMessage{Type: WSMessageTypeLabelPrintRequested, LabelPrintRequest: &resp}, nil
	})
	// 刷れた・消えた（緊急を取り消した）ものは配らない
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		log.Printf("failed to publish label print request %s: %v", id, err)
	}
}

// publishLabelPrintDone は刷れたことを、このインスタンスの画面へ配り、ほかのインスタンスへ DB の通知で知らせる。
func publishLabelPrintDone(db *gorm.DB, hub *Hub, id uuid.UUID) {
	broadcastLabelPrintDone(hub, id)
	notifyChanged(db, labelPrintDoneChannel, instanceID+" "+id.String())
}

// broadcastLabelPrintDone は刷れたことを、このインスタンスの画面へだけ配る（ほかのインスタンスからの通知でも使う）。
func broadcastLabelPrintDone(hub *Hub, id uuid.UUID) {
	_ = hub.Publish(func() (WSMessage, error) {
		return WSMessage{Type: WSMessageTypeLabelPrintDone, LabelPrintRequestID: &id}, nil
	})
}
