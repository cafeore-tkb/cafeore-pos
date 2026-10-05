package handlers

// Square 連携を、実際の Postgres と偽の Square サーバーで通しで確かめる。
//
// CI のテストは DB を使わないので、SQUARE_INTEGRATION_DATABASE_URL が無ければ
// スキップする。手元で動かすときは、捨ててよい空の DB を用意して
//
//	SQUARE_INTEGRATION_DATABASE_URL=postgres://postgres@localhost:5432/square_test?sslmode=disable go test ./internal/handlers -run Integration -v
//
// テーブルは毎回作り直す（中身は消える）。

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"cafeore-pos/api/internal/models"
	"cafeore-pos/api/internal/notify"
	"cafeore-pos/api/internal/square"
)

// fakeSquare は Terminal API と Payments API のうち使う部分だけを真似る。
type fakeSquare struct {
	mu        sync.Mutex
	checkouts map[string]*square.TerminalCheckout
	payments  map[string]*square.Payment
	created   []map[string]any
}

func newFakeSquare(t *testing.T) (*fakeSquare, *httptest.Server) {
	fake := &fakeSquare{checkouts: map[string]*square.TerminalCheckout{}, payments: map[string]*square.Payment{}}
	server := httptest.NewServer(http.HandlerFunc(fake.serve))
	t.Cleanup(server.Close)
	return fake, server
}

func (f *fakeSquare) serve(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	writeJSON := func(status int, value any) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(value)
	}
	path := r.URL.Path
	switch {
	case r.Method == http.MethodPost && path == "/v2/terminals/checkouts":
		var body struct {
			IdempotencyKey string                  `json:"idempotency_key"`
			Checkout       square.TerminalCheckout `json:"checkout"`
		}
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &body)
		var generic map[string]any
		_ = json.Unmarshal(raw, &generic)
		f.created = append(f.created, generic)
		checkout := body.Checkout
		checkout.ID = "chk_" + strings.ReplaceAll(body.IdempotencyKey, "-", "")[:12]
		checkout.Status = squareStatusPending
		f.checkouts[checkout.ID] = &checkout
		writeJSON(http.StatusOK, map[string]any{"checkout": checkout})
	case r.Method == http.MethodGet && strings.HasPrefix(path, "/v2/terminals/checkouts/"):
		checkout, ok := f.checkouts[strings.TrimPrefix(path, "/v2/terminals/checkouts/")]
		if !ok {
			writeJSON(http.StatusNotFound, map[string]any{"errors": []square.Error{{Code: "NOT_FOUND"}}})
			return
		}
		writeJSON(http.StatusOK, map[string]any{"checkout": checkout})
	case r.Method == http.MethodPost && strings.HasSuffix(path, "/cancel"):
		id := strings.TrimSuffix(strings.TrimPrefix(path, "/v2/terminals/checkouts/"), "/cancel")
		checkout, ok := f.checkouts[id]
		if !ok || checkout.Status == squareStatusCompleted {
			writeJSON(http.StatusBadRequest, map[string]any{"errors": []square.Error{{Code: "BAD_REQUEST", Detail: "cannot cancel"}}})
			return
		}
		checkout.Status = squareStatusCanceled
		checkout.CancelReason = "SELLER_CANCELED"
		writeJSON(http.StatusOK, map[string]any{"checkout": checkout})
	case r.Method == http.MethodGet && strings.HasPrefix(path, "/v2/payments/"):
		payment, ok := f.payments[strings.TrimPrefix(path, "/v2/payments/")]
		if !ok {
			writeJSON(http.StatusNotFound, map[string]any{"errors": []square.Error{{Code: "NOT_FOUND"}}})
			return
		}
		writeJSON(http.StatusOK, map[string]any{"payment": payment})
	default:
		writeJSON(http.StatusNotFound, map[string]any{"errors": []square.Error{{Code: "NOT_FOUND"}}})
	}
}

// complete は端末でお客さんが支払い終えた状態にする。
func (f *fakeSquare) complete(checkoutID string, paid int64) {
	f.mu.Lock()
	defer f.mu.Unlock()
	paymentID := "pay_" + checkoutID
	f.payments[paymentID] = &square.Payment{ID: paymentID, Status: "COMPLETED", AmountMoney: square.Money{Amount: paid, Currency: "JPY"}}
	checkout := f.checkouts[checkoutID]
	checkout.Status = squareStatusCompleted
	checkout.PaymentIDs = []string{paymentID}
}

type integrationEnv struct {
	t      *testing.T
	db     *gorm.DB
	router *gin.Engine
	fake   *fakeSquare
	menuID uuid.UUID
}

const integrationWebhookKey = "webhook-key"
const integrationWebhookURL = "https://api.example.com/api/square/webhook"

func newIntegrationEnv(t *testing.T) *integrationEnv {
	dsn := os.Getenv("SQUARE_INTEGRATION_DATABASE_URL")
	if dsn == "" {
		t.Skip("SQUARE_INTEGRATION_DATABASE_URL が無いのでスキップ")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`).Error; err != nil {
		t.Fatal(err)
	}
	all := []any{
		&models.ItemType{}, &models.Item{}, &models.Menu{}, &models.MenuItem{}, &models.Order{},
		&models.Comment{}, &models.OrderMenu{}, &models.MasterState{}, &models.StockResource{},
		&models.ItemStockUsage{}, &models.StockEvent{}, &models.ColorSetting{}, &models.SquareCheckout{},
	}
	if err := db.Migrator().DropTable(all...); err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(all...); err != nil {
		t.Fatal(err)
	}

	itemType := models.ItemType{Name: "hot", DisplayName: "ホット"}
	item := models.Item{Name: "ブレンド", Abbr: "ブ", ItemType: itemType}
	menu := models.Menu{Name: "ブレンド", Abbr: "ブ", Price: 600, Key: "b"}
	if err := db.Create(&item).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&menu).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&models.MenuItem{MenuID: menu.ID, ItemID: item.ID, Quantity: 1}).Error; err != nil {
		t.Fatal(err)
	}

	fake, server := newFakeSquare(t)
	squareHandler, err := NewSquareHandler(db, SquareConfig{
		AccessToken: "token", Environment: "sandbox", DeviceID: "device-1",
		WebhookSignatureKey: integrationWebhookKey, WebhookURL: integrationWebhookURL,
	})
	if err != nil {
		t.Fatal(err)
	}
	squareHandler.client = square.NewClient(server.URL, "token")

	hub := NewHub()
	go hub.Run()
	inventory := NewInventory(db, notify.NewSlack(""), RemindAuth{}, "")
	orderHandler := NewOrderHandler(db, hub, inventory)

	gin.SetMode(gin.TestMode)
	router := gin.New()
	api := router.Group("/api")
	api.POST("/orders", orderHandler.CreateOrder)
	api.DELETE("/orders/:id", orderHandler.DeleteOrder)
	api.GET("/square/status", squareHandler.GetStatus)
	api.POST("/square/checkouts", squareHandler.CreateCheckout)
	api.GET("/square/checkouts/unlinked", squareHandler.GetUnlinkedCheckouts)
	api.GET("/square/checkouts/:id", squareHandler.GetCheckout)
	api.POST("/square/checkouts/:id/cancel", squareHandler.CancelCheckout)
	api.POST("/square/webhook", squareHandler.ReceiveWebhook)

	return &integrationEnv{t: t, db: db, router: router, fake: fake, menuID: menu.ID}
}

func (e *integrationEnv) call(method, path string, body any, headers map[string]string, out any) int {
	e.t.Helper()
	var reader io.Reader
	if raw, ok := body.([]byte); ok {
		reader = bytes.NewReader(raw)
	} else if body != nil {
		encoded, _ := json.Marshal(body)
		reader = bytes.NewReader(encoded)
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Content-Type", "application/json")
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	rec := httptest.NewRecorder()
	e.router.ServeHTTP(rec, req)
	if out != nil {
		if err := json.Unmarshal(rec.Body.Bytes(), out); err != nil {
			e.t.Fatalf("%s %s: cannot decode %q: %v", method, path, rec.Body.String(), err)
		}
	}
	return rec.Code
}

func (e *integrationEnv) createCheckout(key string, amount int) (int, models.SquareCheckoutResponse, models.SquareCheckoutConflictResponse) {
	e.t.Helper()
	var raw json.RawMessage
	status := e.call(http.MethodPost, "/api/square/checkouts", map[string]any{
		"idempotency_key": key, "amount": amount, "payment_type": "CARD_PRESENT", "order_number": 12,
	}, nil, &raw)
	var checkout models.SquareCheckoutResponse
	var conflict models.SquareCheckoutConflictResponse
	if status == http.StatusConflict {
		_ = json.Unmarshal(raw, &conflict)
	} else {
		_ = json.Unmarshal(raw, &checkout)
	}
	return status, checkout, conflict
}

func (e *integrationEnv) createOrder(orderNumber, billing int, checkoutID *uuid.UUID) (int, map[string]any) {
	e.t.Helper()
	body := map[string]any{
		"order_id": orderNumber, "billing_amount": billing, "received": 0,
		"menu_ids": []map[string]any{{"menu_id": e.menuID, "assignee": nil}},
	}
	if checkoutID != nil {
		body["payment_method"] = "square"
		body["square_checkout_id"] = checkoutID.String()
	}
	var out map[string]any
	status := e.call(http.MethodPost, "/api/orders", body, nil, &out)
	return status, out
}

func TestSquareIntegrationPaymentThenOrder(t *testing.T) {
	env := newIntegrationEnv(t)

	var status models.SquareStatusResponse
	if code := env.call(http.MethodGet, "/api/square/status", nil, nil, &status); code != http.StatusOK || !status.Enabled || !status.WebhookEnabled {
		t.Fatalf("status: %d %+v", code, status)
	}

	key := uuid.NewString()
	code, checkout, _ := env.createCheckout(key, 600)
	if code != http.StatusCreated || checkout.Outcome != models.Pending || checkout.CheckoutId == nil || checkout.Status != squareStatusPending {
		t.Fatalf("create: %d %+v", code, checkout)
	}
	sent := env.fake.created[0]["checkout"].(map[string]any)
	if sent["reference_id"] != checkout.Id.String() || sent["note"] != "No.12" || sent["payment_type"] != "CARD_PRESENT" {
		t.Fatalf("unexpected request to Square: %v", sent)
	}

	// 同じキーの再送は同じ依頼を返し、Square には二度送らない。
	code, again, _ := env.createCheckout(key, 600)
	if code != http.StatusOK || again.Id != checkout.Id || len(env.fake.created) != 1 {
		t.Fatalf("retry: %d %+v (sent %d)", code, again, len(env.fake.created))
	}

	// 進行中は別の依頼を出せない。
	code, _, conflict := env.createCheckout(uuid.NewString(), 600)
	if code != http.StatusConflict || conflict.Checkout.Id != checkout.Id {
		t.Fatalf("conflict: %d %+v", code, conflict)
	}

	// 支払いが終わる前は注文を作れない。
	checkoutID := uuid.UUID(checkout.Id)
	if code, body := env.createOrder(1, 600, &checkoutID); code != http.StatusConflict {
		t.Fatalf("order before payment: %d %v", code, body)
	}

	env.fake.complete(*checkout.CheckoutId, 600)
	var polled models.SquareCheckoutResponse
	env.call(http.MethodGet, "/api/square/checkouts/"+checkout.Id.String(), nil, nil, &polled)
	if polled.Outcome != models.Paid || polled.PaidAmount == nil || *polled.PaidAmount != 600 || len(polled.PaymentIds) != 1 {
		t.Fatalf("poll after payment: %+v", polled)
	}

	// 請求額と合わない注文には使えない。
	if code, body := env.createOrder(1, 700, &checkoutID); code != http.StatusConflict {
		t.Fatalf("billing mismatch: %d %v", code, body)
	}
	code, order := env.createOrder(1, 600, &checkoutID)
	if code != http.StatusCreated || order["payment_method"] != "square" || order["received"] != float64(600) {
		t.Fatalf("order: %d %v", code, order)
	}
	// 同じ決済で二つ目の注文は作れない。
	if code, body := env.createOrder(2, 600, &checkoutID); code != http.StatusConflict {
		t.Fatalf("reuse: %d %v", code, body)
	}
	// 失敗した注文の行が残っていないこと（トランザクションで戻る）。
	var orderCount int64
	env.db.Model(&models.Order{}).Count(&orderCount)
	if orderCount != 1 {
		t.Fatalf("expected exactly one order, got %d", orderCount)
	}

	var unlinked []models.SquareCheckoutResponse
	env.call(http.MethodGet, "/api/square/checkouts/unlinked", nil, nil, &unlinked)
	if len(unlinked) != 0 {
		t.Fatalf("linked checkout listed as unlinked: %+v", unlinked)
	}
	// 注文を消すと、支払いは照合の一覧に戻る。
	if code := env.call(http.MethodDelete, "/api/orders/"+order["id"].(string), nil, nil, nil); code != http.StatusOK {
		t.Fatalf("delete: %d", code)
	}
	env.call(http.MethodGet, "/api/square/checkouts/unlinked", nil, nil, &unlinked)
	if len(unlinked) != 1 || unlinked[0].Id != checkout.Id {
		t.Fatalf("unlinked after delete: %+v", unlinked)
	}

	// 現金の注文は今までどおり。
	code, cash := env.createOrder(3, 600, nil)
	if code != http.StatusCreated || cash["payment_method"] != "cash" {
		t.Fatalf("cash order: %d %v", code, cash)
	}
}

func TestSquareIntegrationCancel(t *testing.T) {
	env := newIntegrationEnv(t)
	code, checkout, _ := env.createCheckout(uuid.NewString(), 600)
	if code != http.StatusCreated {
		t.Fatalf("create: %d", code)
	}
	var canceled models.SquareCheckoutResponse
	if code := env.call(http.MethodPost, "/api/square/checkouts/"+checkout.Id.String()+"/cancel", nil, nil, &canceled); code != http.StatusOK {
		t.Fatalf("cancel: %d %+v", code, canceled)
	}
	if canceled.Outcome != models.Failed || canceled.CancelReason == nil || *canceled.CancelReason != "SELLER_CANCELED" {
		t.Fatalf("canceled: %+v", canceled)
	}
	// 取り消した後は次の依頼を出せる。
	if code, _, _ := env.createCheckout(uuid.NewString(), 600); code != http.StatusCreated {
		t.Fatalf("next checkout after cancel: %d", code)
	}
}

func TestSquareIntegrationWebhook(t *testing.T) {
	env := newIntegrationEnv(t)
	code, checkout, _ := env.createCheckout(uuid.NewString(), 600)
	if code != http.StatusCreated {
		t.Fatalf("create: %d", code)
	}
	// 作成の応答が失われ、checkout_id を記録できなかった場合を作る。reference_id で引けること。
	env.db.Model(&models.SquareCheckout{}).Where("id = ?", uuid.UUID(checkout.Id)).Update("checkout_id", nil)
	env.fake.complete(*checkout.CheckoutId, 600)

	body := []byte(fmt.Sprintf(`{"type":"terminal.checkout.updated","data":{"type":"checkout","id":%q,"object":{"checkout":{"id":%q,"reference_id":%q,"status":"COMPLETED","payment_ids":["pay_%s"],"amount_money":{"amount":600,"currency":"JPY"},"device_options":{"device_id":"device-1"}}}}}`,
		*checkout.CheckoutId, *checkout.CheckoutId, checkout.Id.String(), *checkout.CheckoutId))

	if code := env.call(http.MethodPost, "/api/square/webhook", body, map[string]string{square.SignatureHeader: "forged"}, nil); code != http.StatusForbidden {
		t.Fatalf("forged webhook must be rejected: %d", code)
	}
	var stored models.SquareCheckout
	env.db.First(&stored, "id = ?", uuid.UUID(checkout.Id))
	if stored.Status == squareStatusCompleted {
		t.Fatal("forged webhook must not change the record")
	}

	signature := square.Sign(integrationWebhookKey, integrationWebhookURL, body)
	if code := env.call(http.MethodPost, "/api/square/webhook", body, map[string]string{square.SignatureHeader: signature}, nil); code != http.StatusOK {
		t.Fatalf("webhook: %d", code)
	}
	env.db.First(&stored, "id = ?", uuid.UUID(checkout.Id))
	if stored.Status != squareStatusCompleted || stored.CheckoutID == nil || stored.PaidAmount == nil || *stored.PaidAmount != 600 {
		t.Fatalf("webhook did not update the record: %+v", stored)
	}

	// レジが落ちていた想定。注文が無いので照合の一覧に出る。
	var unlinked []models.SquareCheckoutResponse
	env.call(http.MethodGet, "/api/square/checkouts/unlinked", nil, nil, &unlinked)
	if len(unlinked) != 1 || unlinked[0].Outcome != models.Paid {
		t.Fatalf("unlinked: %+v", unlinked)
	}

	// 知らない checkout の通知は無視して 200。
	other := []byte(`{"type":"terminal.checkout.updated","data":{"object":{"checkout":{"id":"unknown","reference_id":"not-a-uuid","status":"COMPLETED"}}}}`)
	if code := env.call(http.MethodPost, "/api/square/webhook", other, map[string]string{square.SignatureHeader: square.Sign(integrationWebhookKey, integrationWebhookURL, other)}, nil); code != http.StatusOK {
		t.Fatalf("unknown checkout: %d", code)
	}
}
