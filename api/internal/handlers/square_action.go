// api/internal/handlers/square_action.go
package handlers

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"slices"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"
	"gorm.io/gorm"

	"cafeore-pos/api/internal/models"
	"cafeore-pos/api/internal/square"
)

// お客さんが Square Terminal で決済手段を選ぶ画面（Terminal action の SELECT）。
//
// レジは会計の段階に入ったらこれを出し、お客さんが選んだらその決済手段で会計する。
// スタッフがレジで決済手段を選んだとき・会計を終えたときは取り消す。
// お金は動かないので、決済依頼（square.go）と違って照合や返金は無い。
//
// 端末への依頼は 1 件ずつ順に出る。この画面を出したままだと、後から出した決済画面が
// その後ろに並んで出てこないので、決済依頼を作る前にその端末のこの画面を取り消す。

const (
	squareActionTypeSelect = "SELECT"
	// Square が自動で取り消すまでの時間。Square の上限が 5 分。
	squareActionDeadline         = 5 * time.Minute
	squareActionDeadlineDuration = "PT5M"
	// Square の SELECT に並べられる選択肢の数。
	squareActionMinOptions = 2
	squareActionMaxOptions = 5
)

// squareActionOptionTitle は端末のボタンに出す文字。レジのボタンと揃える。
var squareActionOptionTitle = map[models.SquareActionOption]string{
	models.OptionCash:        "現金",
	models.OptionCardPresent: "カード",
	models.OptionFelicaAll:   "電子マネー",
	models.OptionQrCode:      "QR コード",
}

// --------------------------------------------------
// 状態の判定（純粋な関数）
// --------------------------------------------------

// squareActionSettled は、結果が決まっていて Square に問い合わせ直す必要が無いかを返す。
func squareActionSettled(status string) bool {
	switch status {
	case squareStatusCompleted, squareStatusCanceled, squareStatusError:
		return true
	}
	return false
}

// squareActionOutcome はレジが次にすべきことを決める。
func squareActionOutcome(action *models.SquareAction, now time.Time) models.SquareActionOutcome {
	switch action.Status {
	case squareStatusCompleted:
		if action.Selected == nil {
			return models.ActionClosed
		}
		return models.ActionSelected
	case squareStatusCanceled, squareStatusError:
		return models.ActionClosed
	case squareStatusCreating:
		if now.After(action.CreatedAt.Add(squareCreatingStale)) {
			return models.ActionClosed
		}
		return models.ActionPending
	default:
		// PENDING / IN_PROGRESS / CANCEL_REQUESTED と、知らない値。
		// 期限を過ぎても取り消されたと分からない（問い合わせに失敗し続けている）なら、待つのをやめる。
		if now.After(action.CreatedAt.Add(squareActionDeadline + squareTimeoutGrace)) {
			return models.ActionClosed
		}
		return models.ActionPending
	}
}

// applySquareAction は Square から受け取った action を記録に写す。
// 選ばれた・取り消された後は変えない（取り消しの応答と問い合わせの応答が前後しても壊れないように）。
// 選ばれた選択肢は、並べたもののどれかのときだけ記録する。
func applySquareAction(record *models.SquareAction, remote *square.TerminalAction) {
	if remote.ID != "" && record.ActionID == nil {
		id := remote.ID
		record.ActionID = &id
	}
	if record.Status == squareStatusCompleted || record.Status == squareStatusCanceled {
		return
	}
	if remote.Status != "" {
		record.Status = remote.Status
	}
	if remote.CancelReason != "" {
		reason := remote.CancelReason
		record.CancelReason = &reason
	}
	if remote.SelectOptions != nil && remote.SelectOptions.SelectedOption != nil {
		selected := remote.SelectOptions.SelectedOption.ReferenceID
		if slices.Contains(record.Options, selected) {
			record.Selected = &selected
		}
	}
}

func validateSquareActionRequest(req models.SquareActionCreateRequest) error {
	if req.IdempotencyKey == "" || len(req.IdempotencyKey) > squareIdempotencyKeyMaxLength {
		return fmt.Errorf("idempotency_key は 1〜%d 文字にしてください", squareIdempotencyKeyMaxLength)
	}
	if req.DeviceId == "" {
		return errors.New("device_id を指定してください（レジで Square 端末を選んでください）")
	}
	if req.Amount < 1 {
		return errors.New("amount は 1 円以上にしてください")
	}
	if len(req.Options) < squareActionMinOptions || len(req.Options) > squareActionMaxOptions {
		return fmt.Errorf("options は %d〜%d 個にしてください", squareActionMinOptions, squareActionMaxOptions)
	}
	seen := map[models.SquareActionOption]bool{}
	for _, option := range req.Options {
		if _, ok := squareActionOptionTitle[option]; !ok {
			return fmt.Errorf("options の %q には対応していません", option)
		}
		if seen[option] {
			return fmt.Errorf("options の %q が重複しています", option)
		}
		seen[option] = true
	}
	return nil
}

// buildTerminalAction は Square に送る action を組み立てる。
// 選択肢の reference_id にはこちらの値（SquareActionOption）をそのまま入れ、選ばれたものを読み戻す。
func buildTerminalAction(record *models.SquareAction) square.TerminalAction {
	options := make([]square.SelectOption, 0, len(record.Options))
	for _, option := range record.Options {
		options = append(options, square.SelectOption{
			ReferenceID: option,
			Title:       squareActionOptionTitle[models.SquareActionOption(option)],
		})
	}
	return square.TerminalAction{
		DeviceID:         record.DeviceID,
		DeadlineDuration: squareActionDeadlineDuration,
		Type:             squareActionTypeSelect,
		SelectOptions: &square.SelectOptions{
			Title:   "お支払い方法を選んでください",
			Body:    "お会計 " + groupThousands(record.Amount) + " 円",
			Options: options,
		},
	}
}

// groupThousands は 0 以上の整数に 3 桁ごとにカンマを入れる（1200 → 1,200）。
func groupThousands(value int) string {
	digits := strconv.Itoa(value)
	for i := len(digits) - 3; i > 0; i -= 3 {
		digits = digits[:i] + "," + digits[i:]
	}
	return digits
}

func toSquareActionResponse(action *models.SquareAction, now time.Time) models.SquareActionResponse {
	options := make([]models.SquareActionOption, 0, len(action.Options))
	for _, option := range action.Options {
		options = append(options, models.SquareActionOption(option))
	}
	return models.SquareActionResponse{
		Id:           openapi_types.UUID(action.ID),
		DeviceId:     action.DeviceID,
		ActionId:     action.ActionID,
		Status:       action.Status,
		Outcome:      squareActionOutcome(action, now),
		CancelReason: action.CancelReason,
		Amount:       action.Amount,
		Options:      options,
		Selected:     action.Selected,
		ErrorMessage: action.ErrorMessage,
		CreatedAt:    action.CreatedAt,
		UpdatedAt:    action.UpdatedAt,
	}
}

// --------------------------------------------------
// Square との同期
// --------------------------------------------------

// refreshAction は結果が決まっていない記録を Square に問い合わせて最新にし、保存する。
// 問い合わせに失敗しても記録は返す（レジは次のポーリングで再試行する）。
func (h *SquareHandler) refreshAction(ctx context.Context, record *models.SquareAction) {
	if !h.enabled() || record.ActionID == nil || squareActionSettled(record.Status) {
		return
	}
	remote, err := h.client.GetTerminalAction(ctx, *record.ActionID)
	if err != nil {
		log.Printf("square: failed to get action %s: %v", *record.ActionID, err)
		return
	}
	applySquareAction(record, remote)
	h.saveAction(record)
}

// cancelAction は action の取り消しを Square に頼み、記録を最新にする。
// 既に選ばれていた・取り消されていたなどで断られても、問い合わせ直して結果が決まっていればエラーにしない。
func (h *SquareHandler) cancelAction(ctx context.Context, record *models.SquareAction) error {
	remote, err := h.client.CancelTerminalAction(ctx, *record.ActionID)
	if err != nil {
		h.refreshAction(ctx, record)
		if squareActionSettled(record.Status) {
			return nil
		}
		return err
	}
	applySquareAction(record, remote)
	h.saveAction(record)
	return nil
}

// cancelPendingActions は、その端末に出したまま結果が決まっていない画面を取り消す。
// idempotency_key が exceptKey のもの（同じ依頼の再送）は残す。
// 取り消せなくても止めない（後から出すものが、その画面の後ろに並ぶだけ）。
// Square の応答待ちの間に作成のロックを持ち続けないよう、ロックの外で呼ぶ。
func (h *SquareHandler) cancelPendingActions(ctx context.Context, deviceID, exceptKey string) error {
	var actions []models.SquareAction
	err := h.db.
		Where("device_id = ? AND action_id IS NOT NULL AND status NOT IN ? AND idempotency_key <> ? AND created_at > ?",
			deviceID,
			[]string{squareStatusCompleted, squareStatusCanceled, squareStatusError, squareStatusCancelRequested},
			exceptKey,
			h.now().Add(-(squareActionDeadline + squareTimeoutGrace))).
		Find(&actions).Error
	if err != nil {
		return err
	}
	for i := range actions {
		if err := h.cancelAction(ctx, &actions[i]); err != nil {
			log.Printf("square: failed to cancel action %s: %v", *actions[i].ActionID, err)
		}
	}
	return nil
}

func (h *SquareHandler) saveAction(record *models.SquareAction) {
	if err := h.db.Model(record).Select(
		"ActionID", "Status", "CancelReason", "Selected", "ErrorMessage", "UpdatedAt",
	).Updates(record).Error; err != nil {
		log.Printf("square: failed to save action %s: %v", record.ID, err)
	}
}

// --------------------------------------------------
// ハンドラー
// --------------------------------------------------

// POST /api/square/actions
func (h *SquareHandler) CreateAction(c *gin.Context) {
	if !h.enabled() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Square 連携が設定されていません"})
		return
	}
	var req models.CreateSquareActionJSONRequestBody
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := validateSquareActionRequest(req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	ctx := c.Request.Context()

	// 決済が進行中かどうかは Square に問い合わせないと分からない。ロックを取る前に最新にしておく。
	if err := h.refreshActiveCandidates(ctx, req.DeviceId); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	// 前に出した画面が残っていると、新しい画面がその後ろに並ぶ。先に取り消す。
	if err := h.cancelPendingActions(ctx, req.DeviceId, req.IdempotencyKey); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	options := make([]string, 0, len(req.Options))
	for _, option := range req.Options {
		options = append(options, string(option))
	}
	record := models.SquareAction{
		ID:             uuid.New(),
		IdempotencyKey: req.IdempotencyKey,
		DeviceID:       req.DeviceId,
		Amount:         req.Amount,
		Options:        options,
		Status:         squareStatusCreating,
	}
	var existing *models.SquareAction
	busy := false
	// 決済依頼の作成と同じロックで 1 件ずつ通す。作っている途中（CREATING）の決済依頼も進行中として見るため。
	err := h.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SELECT pg_advisory_xact_lock(?)", squareCheckoutLockKey).Error; err != nil {
			return err
		}

		// 同じ idempotency_key の再送には、作り直さず同じものを返す。
		var found models.SquareAction
		err := tx.Where("idempotency_key = ?", req.IdempotencyKey).First(&found).Error
		if err == nil {
			existing = &found
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}

		registered, err := isRegisteredSquareDevice(tx, req.DeviceId)
		if err != nil {
			return err
		}
		if !registered {
			return errSquareDeviceNotRegistered
		}

		// 決済画面を出している端末に出すと、決済の後ろに並んで、決済が終わってから出てしまう。
		active, err := findActiveCheckout(tx, h.now(), req.DeviceId)
		if err != nil {
			return err
		}
		if active != nil {
			busy = true
			return nil
		}
		return tx.Create(&record).Error
	})
	if errors.Is(err, errSquareDeviceNotRegistered) {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if existing != nil {
		h.refreshAction(ctx, existing)
		c.JSON(http.StatusOK, toSquareActionResponse(existing, h.now()))
		return
	}
	if busy {
		c.JSON(http.StatusConflict, gin.H{"error": "この端末で決済が進行中なので、決済手段を選ぶ画面は出しません"})
		return
	}

	remote, err := h.client.CreateTerminalAction(ctx, req.IdempotencyKey, buildTerminalAction(&record))
	if err != nil {
		log.Printf("square: failed to create action %s: %v", record.ID, err)
		message := err.Error()
		record.Status = squareStatusError
		record.ErrorMessage = &message
		h.saveAction(&record)
		c.JSON(http.StatusBadGateway, toSquareActionResponse(&record, h.now()))
		return
	}
	applySquareAction(&record, remote)
	h.saveAction(&record)
	c.JSON(http.StatusCreated, toSquareActionResponse(&record, h.now()))
}

func (h *SquareHandler) findAction(c *gin.Context) (*models.SquareAction, bool) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID format"})
		return nil, false
	}
	var record models.SquareAction
	if err := h.db.First(&record, "id = ?", id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Action not found"})
			return nil, false
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return nil, false
	}
	return &record, true
}

// GET /api/square/actions/:id
func (h *SquareHandler) GetAction(c *gin.Context) {
	record, ok := h.findAction(c)
	if !ok {
		return
	}
	h.refreshAction(c.Request.Context(), record)
	c.JSON(http.StatusOK, toSquareActionResponse(record, h.now()))
}

// POST /api/square/actions/:id/cancel
func (h *SquareHandler) CancelAction(c *gin.Context) {
	if !h.enabled() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Square 連携が設定されていません"})
		return
	}
	record, ok := h.findAction(c)
	if !ok {
		return
	}
	// 既に選ばれた・取り消された・出せなかったものは、そのまま返す。
	if squareActionOutcome(record, h.now()) != models.ActionPending || record.Status == squareStatusCancelRequested {
		c.JSON(http.StatusOK, toSquareActionResponse(record, h.now()))
		return
	}
	if record.ActionID == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "Square に届いていない依頼は取り消せません"})
		return
	}
	if err := h.cancelAction(c.Request.Context(), record); err != nil {
		log.Printf("square: failed to cancel action %s: %v", *record.ActionID, err)
		c.JSON(http.StatusBadGateway, gin.H{"error": "取り消せませんでした。端末の画面を確認してください: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, toSquareActionResponse(record, h.now()))
}
