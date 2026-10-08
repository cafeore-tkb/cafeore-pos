package handlers

import (
	"errors"
	"log"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"
	"gorm.io/gorm"

	"cafeore-pos/api/internal/models"
)

// 印刷キュー（print_jobs。models.PrintJobRow）。
//
// レジ・マスター・CaOS はキューに積むだけにする（レジの会計は POST /api/orders の print_labels で注文と同じトランザクション、
// マスターの緊急ボタンは POST /api/print-jobs、CaOS の緊急の入れ直しは操作と同じトランザクション）。
// プリンターにつないだ端末（「この端末で印刷する」にした端末）が、積んだ順に 1 件ずつ取り（claim）、印刷して済み（done）・失敗（failed）にする。
//   - 取るときは SELECT ... FOR UPDATE SKIP LOCKED で 1 件だけ取って印刷中にするので、印刷する端末が複数あっても同じ仕事を 2 台が取らない
//   - 同時に積まれても、1 件ずつ行になるので抜けない。済みにした仕事は二度と取られないので 2 重に印刷しない
//   - 失敗は残して画面に出し、人が「もう一度印刷」（retry）か「取り消す」（cancel）を選ぶ。
//     印刷中のまま止まった仕事（印刷した端末が落ちたなど）も、printJobStaleAfter たてば同じように選べる
//
// シールに何を書くかはキューに持たない。印刷する端末が、取ったときに返す注文から作る（@cafeore/common の printJobLabels。レジと緊急で同じ作り方）。
// 配信は注文と同じ：変えたインスタンスが自分の画面へ {"type":"print_jobs"}（まだ終わっていない仕事の全部）を配り、
// DB の通知 print_jobs_changed でほかのインスタンスに知らせる。受けたインスタンスは DB から読み直して配る（order_listener.go）。

// printJobsChangedChannel は print_jobs が変わったことをインスタンス同士で知らせる DB の通知のチャンネル。通知の中身は "<送ったインスタンスの ID>"
const printJobsChangedChannel = "print_jobs_changed"

const (
	printJobQueued   = string(models.PrintJobStatusQueued)
	printJobPrinting = string(models.PrintJobStatusPrinting)
	printJobDone     = string(models.PrintJobStatusDone)
	printJobFailed   = string(models.PrintJobStatusFailed)
	printJobCanceled = string(models.PrintJobStatusCanceled)

	printJobKindOrder     = string(models.PrintJobKindOrder)
	printJobKindEmergency = string(models.PrintJobKindEmergency)

	printJobSourceCaos = string(models.PrintJobSourceCaos)
)

// 印刷中のまま、この時間たっても済みにならない仕事は止まったとみなし、「もう一度印刷」「取り消す」を許す。
// 印刷は数秒で終わるので、まだ印刷している仕事を取り直して 2 重に印刷しないよう、十分に長くとる。
const printJobStaleAfter = time.Minute

const maxPrinterIDLength = 100
const maxPrintErrorLength = 500

// isLabelCup は、ラベル（シール）を印刷するカップか。アイスミルク（milk）とグッズ（others）にはシールが無い。
// 画面のシールの作り方（@cafeore/common の orderCupLabels。OrderEntity.getCoffeeCups と同じ）と同じ決まり。
func isLabelCup(cup models.OrderCup) bool {
	name := cup.Item.ItemType.Name
	return name != "milk" && name != goodsItemTypeName
}

func newPrintJobRow(kind, source string, order *models.Order, cupID *uuid.UUID, now time.Time) models.PrintJobRow {
	return models.PrintJobRow{
		Kind: kind, Source: source, OrderID: order.ID, OrderNo: order.OrderId, CupID: cupID,
		Status: printJobQueued, CreatedAt: now, UpdatedAt: now,
	}
}

func toPrintJob(r *models.PrintJobRow) models.PrintJob {
	job := models.PrintJob{
		Id: r.ID, Kind: models.PrintJobKind(r.Kind), Source: models.PrintJobSource(r.Source),
		OrderId: openapi_types.UUID(r.OrderID), OrderNo: r.OrderNo, Status: models.PrintJobStatus(r.Status),
		PrinterId: r.PrinterID, ClaimedAt: utcPtr(r.ClaimedAt), FinishedAt: utcPtr(r.FinishedAt), Error: r.Error,
		Attempts: r.Attempts, CreatedAt: r.CreatedAt.UTC(), UpdatedAt: r.UpdatedAt.UTC(),
	}
	if r.CupID != nil {
		id := openapi_types.UUID(*r.CupID)
		job.CupId = &id
	}
	return job
}

// activePrintJobs はまだ終わっていない仕事（待ち・印刷中・失敗）を積んだ順に返す。
func activePrintJobs(db *gorm.DB) ([]models.PrintJob, error) {
	var rows []models.PrintJobRow
	if err := db.Where("status IN ?", []string{printJobQueued, printJobPrinting, printJobFailed}).Order("id").Find(&rows).Error; err != nil {
		return nil, err
	}
	jobs := make([]models.PrintJob, len(rows))
	for i := range rows {
		jobs[i] = toPrintJob(&rows[i])
	}
	return jobs, nil
}

// まだ終わっていない仕事の全部を WSMessage にする。読めなかったら ok = false
func printJobsMessage(db *gorm.DB) (WSMessage, bool) {
	jobs, err := activePrintJobs(db)
	if err != nil {
		log.Printf("print: failed to read the print jobs: %v", err)
		return WSMessage{}, false
	}
	return WSMessage{Type: WSMessageTypePrintJobs, PrintJobs: jobs}, true
}

// broadcastPrintJobs は、まだ終わっていない仕事の全部を読み直して、このインスタンスにつないでいる画面へだけ配る。
func broadcastPrintJobs(db *gorm.DB, hub *Hub) {
	_ = hub.Publish(func() (WSMessage, error) {
		msg, ok := printJobsMessage(db)
		if !ok {
			return WSMessage{}, errors.New("failed to load print jobs")
		}
		return msg, nil
	})
}

// publishPrintJobs は仕事を変えたあとに画面へ配り、ほかのインスタンスにも DB の通知で知らせる。
func publishPrintJobs(db *gorm.DB, hub *Hub) {
	broadcastPrintJobs(db, hub)
	notifyChanged(db, printJobsChangedChannel, instanceID)
}

// ---------------------------------------------------------------- API

// PrintJobHandler は印刷キューの API。
type PrintJobHandler struct {
	db  *gorm.DB
	hub *Hub
	now func() time.Time
}

func NewPrintJobHandler(db *gorm.DB, hub *Hub) *PrintJobHandler {
	return &PrintJobHandler{db: db, hub: hub, now: time.Now}
}

// GET /api/print-jobs - まだ終わっていない仕事
func (h *PrintJobHandler) List(c *gin.Context) {
	jobs, err := activePrintJobs(h.db)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, jobs)
}

// POST /api/print-jobs - 積む（マスターの緊急ボタン・注文のラベルの印刷し直し）
func (h *PrintJobHandler) Create(c *gin.Context) {
	var req models.CreatePrintJobJSONRequestBody
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	kind, source := string(req.Kind), string(req.Source)
	if kind != printJobKindOrder && kind != printJobKindEmergency {
		c.JSON(http.StatusBadRequest, gin.H{"error": "kind は order か emergency です"})
		return
	}
	if source != string(models.PrintJobCreateSourceCashier) && source != string(models.PrintJobCreateSourceMaster) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "source は cashier か master です"})
		return
	}
	if kind == printJobKindEmergency && req.CupId == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "緊急の印刷にはカップ（cup_id）が要ります"})
		return
	}
	var order models.Order
	if err := preloadOrder(h.db).First(&order, "id = ?", uuid.UUID(req.OrderId)).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "注文が見つかりません"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	var cupID *uuid.UUID
	if kind == printJobKindEmergency {
		id := uuid.UUID(*req.CupId)
		if msg := checkEmergencyCup(&order, id); msg != "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": msg})
			return
		}
		cupID = &id
	}
	row := newPrintJobRow(kind, source, &order, cupID, h.now())
	if err := h.db.Create(&row).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, toPrintJob(&row))
	publishPrintJobs(h.db, h.hub)
}

// checkEmergencyCup は緊急の印刷ができるカップかを確かめる。できなければ理由を返す。
func checkEmergencyCup(order *models.Order, cupID uuid.UUID) string {
	i := slices.IndexFunc(order.OrderCups, func(cup models.OrderCup) bool { return cup.ID == cupID })
	if i < 0 {
		return "このカップはこの注文にありません"
	}
	if !isLabelCup(order.OrderCups[i]) {
		return "このカップにはシールがありません"
	}
	return ""
}

func printerIDOf(raw string) (string, bool) {
	id := strings.TrimSpace(raw)
	return id, id != "" && utf8.RuneCountInString(id) <= maxPrinterIDLength
}

// POST /api/print-jobs/claim - 印刷する端末が次の仕事を 1 件取る
func (h *PrintJobHandler) Claim(c *gin.Context) {
	var req models.ClaimPrintJobJSONRequestBody
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	printerID, ok := printerIDOf(req.PrinterId)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "printer_id は 1〜100 文字です"})
		return
	}
	changed := false
	defer func() {
		if changed {
			publishPrintJobs(h.db, h.hub)
		}
	}()
	for {
		job, err := claimNextPrintJob(h.db, printerID, h.now())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if job == nil {
			c.Status(http.StatusNoContent)
			return
		}
		changed = true
		var order models.Order
		err = preloadOrder(h.db).First(&order, "id = ?", job.OrderID).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			h.giveUp(job, "注文が消されたため印刷できません")
			continue
		}
		if err != nil {
			// 読めなかっただけなので、待ちに戻して次に取り直す
			if rerr := h.db.Model(&models.PrintJobRow{}).Where("id = ? AND status = ?", job.ID, printJobPrinting).
				Updates(map[string]any{"status": printJobQueued, "printer_id": nil, "claimed_at": nil, "updated_at": h.now()}).Error; rerr != nil {
				log.Printf("print: failed to put back the job %d: %v", job.ID, rerr)
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if job.Kind == printJobKindEmergency {
			if job.CupID == nil {
				h.giveUp(job, "カップが分からないため印刷できません")
				continue
			}
			if msg := checkEmergencyCup(&order, *job.CupID); msg != "" {
				h.giveUp(job, msg+"（注文が変わったため印刷できません）")
				continue
			}
		}
		c.JSON(http.StatusOK, models.PrintJobClaim{Job: toPrintJob(job), Order: toOrderResponse(&order)})
		return
	}
}

// claimNextPrintJob は待ちの仕事を積んだ順に 1 件だけ取って印刷中にする。無ければ nil。
// FOR UPDATE SKIP LOCKED で、ほかの端末が同時に取ろうとしている行は飛ばす（同じ仕事を 2 台が取らない）。
func claimNextPrintJob(db *gorm.DB, printerID string, now time.Time) (*models.PrintJobRow, error) {
	var rows []models.PrintJobRow
	err := db.Raw(`UPDATE print_jobs
		SET status = ?, printer_id = ?, claimed_at = ?, finished_at = NULL, error = NULL, attempts = attempts + 1, updated_at = ?
		WHERE id = (SELECT id FROM print_jobs WHERE status = ? ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
		RETURNING *`, printJobPrinting, printerID, now, now, printJobQueued).Scan(&rows).Error
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return &rows[0], nil
}

// giveUp は取った仕事を、印刷できない理由を付けて失敗にする（画面に出す）。
func (h *PrintJobHandler) giveUp(job *models.PrintJobRow, reason string) {
	now := h.now()
	if err := h.db.Model(&models.PrintJobRow{}).Where("id = ? AND status = ?", job.ID, printJobPrinting).
		Updates(map[string]any{"status": printJobFailed, "error": reason, "finished_at": now, "updated_at": now}).Error; err != nil {
		log.Printf("print: failed to mark the job %d as failed: %v", job.ID, err)
	}
}

func printJobIDOf(c *gin.Context) (int64, bool) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID format"})
		return 0, false
	}
	return id, true
}

// POST /api/print-jobs/:id/done - 印刷できた
func (h *PrintJobHandler) Complete(c *gin.Context) {
	var req models.CompletePrintJobJSONRequestBody
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	h.finish(c, req.PrinterId, printJobDone, nil)
}

// POST /api/print-jobs/:id/failed - 印刷できなかった
func (h *PrintJobHandler) Fail(c *gin.Context) {
	var req models.FailPrintJobJSONRequestBody
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	reason := strings.TrimSpace(req.Error)
	if reason == "" {
		reason = "印刷できませんでした"
	}
	if r := []rune(reason); len(r) > maxPrintErrorLength {
		reason = string(r[:maxPrintErrorLength])
	}
	h.finish(c, req.PrinterId, printJobFailed, &reason)
}

// finish は取った端末が、印刷中の仕事を済み・失敗にする。もうその状態なら同じ結果を返す（応答が届かず送り直したとき）。
func (h *PrintJobHandler) finish(c *gin.Context, rawPrinterID, status string, reason *string) {
	id, ok := printJobIDOf(c)
	if !ok {
		return
	}
	printerID, ok := printerIDOf(rawPrinterID)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "printer_id は 1〜100 文字です"})
		return
	}
	now := h.now()
	res := h.db.Model(&models.PrintJobRow{}).Where("id = ? AND status = ? AND printer_id = ?", id, printJobPrinting, printerID).
		Updates(map[string]any{"status": status, "error": reason, "finished_at": now, "updated_at": now})
	if res.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": res.Error.Error()})
		return
	}
	var row models.PrintJobRow
	if err := h.db.First(&row, "id = ?", id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "印刷の仕事が見つかりません"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	// 同じ端末が同じ結果を送り直したとき（応答が届かずに再送した など）は、もう反映済みなので成功として返す
	alreadyApplied := row.Status == status && row.PrinterID != nil && *row.PrinterID == printerID
	if res.RowsAffected == 0 && !alreadyApplied {
		c.JSON(http.StatusConflict, gin.H{"error": "この端末が印刷中の仕事ではありません"})
		return
	}
	c.JSON(http.StatusOK, toPrintJob(&row))
	if res.RowsAffected > 0 {
		publishPrintJobs(h.db, h.hub)
	}
}

// POST /api/print-jobs/:id/retry - 失敗した・止まった仕事を待ちに戻す
func (h *PrintJobHandler) Retry(c *gin.Context) {
	h.resolve(c, map[string]any{"status": printJobQueued, "printer_id": nil, "claimed_at": nil, "finished_at": nil, "error": nil},
		[]string{printJobFailed}, "もう一度印刷できるのは、失敗した仕事と、印刷中のまま止まった仕事だけです")
}

// POST /api/print-jobs/:id/cancel - 待ち・失敗した・止まった仕事を取り消す
func (h *PrintJobHandler) Cancel(c *gin.Context) {
	h.resolve(c, map[string]any{"status": printJobCanceled, "finished_at": h.now()},
		[]string{printJobQueued, printJobFailed}, "取り消せるのは、待ち・失敗した仕事と、印刷中のまま止まった仕事だけです")
}

// resolve は from の状態か、印刷中のまま printJobStaleAfter たった仕事を、updates のとおりに変える。
func (h *PrintJobHandler) resolve(c *gin.Context, updates map[string]any, from []string, conflict string) {
	id, ok := printJobIDOf(c)
	if !ok {
		return
	}
	now := h.now()
	updates["updated_at"] = now
	res := h.db.Model(&models.PrintJobRow{}).
		Where("id = ? AND (status IN ? OR (status = ? AND claimed_at < ?))", id, from, printJobPrinting, now.Add(-printJobStaleAfter)).
		Updates(updates)
	if res.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": res.Error.Error()})
		return
	}
	var row models.PrintJobRow
	if err := h.db.First(&row, "id = ?", id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "印刷の仕事が見つかりません"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if res.RowsAffected == 0 {
		c.JSON(http.StatusConflict, gin.H{"error": conflict})
		return
	}
	c.JSON(http.StatusOK, toPrintJob(&row))
	publishPrintJobs(h.db, h.hub)
}
