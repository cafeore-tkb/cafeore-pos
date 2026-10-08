package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"cafeore-pos/api/internal/models"
)

// CaOS のドリッパーの担当者の DB のテスト。注文の DB と同じく LISTEN_TEST_DATABASE_URL を渡したときだけ走る（openListenTestDB）。

func (f *caosFixture) getLanes(t *testing.T) models.CaosLanes {
	t.Helper()
	w := callHandler(t, f.caos.GetCaosLanes, http.MethodGet, "")
	if w.Code != http.StatusOK {
		t.Fatalf("GET /api/caos/lanes = %d: %s", w.Code, w.Body)
	}
	return decodeLanes(t, w.Body.Bytes())
}

func decodeLanes(t *testing.T, body []byte) models.CaosLanes {
	t.Helper()
	var lanes models.CaosLanes
	if err := json.Unmarshal(body, &lanes); err != nil {
		t.Fatal(err)
	}
	return lanes
}

// putLane は交代（PUT /api/caos/lanes/:dripper）を呼ぶ。
func (f *caosFixture) putLane(t *testing.T, dripper int, name string, senior bool) (int, string) {
	t.Helper()
	body, _ := json.Marshal(map[string]any{"name": name, "senior": senior})
	w := callWithParams(t, f.caos.PutCaosLane, http.MethodPut, string(body), gin.Params{{Key: "dripper", Value: fmt.Sprint(dripper)}})
	return w.Code, w.Body.String()
}

func (f *caosFixture) mustPutLane(t *testing.T, dripper int, name string, senior bool) models.CaosLanes {
	t.Helper()
	code, body := f.putLane(t, dripper, name, senior)
	if code != http.StatusOK {
		t.Fatalf("PUT /api/caos/lanes/%d = %d: %s", dripper, code, body)
	}
	return decodeLanes(t, []byte(body))
}

func (f *caosFixture) swapLanes(t *testing.T, first, second int) (int, string) {
	t.Helper()
	body, _ := json.Marshal(map[string]any{"first": first, "second": second})
	w := callHandler(t, f.caos.SwapCaosLanes, http.MethodPost, string(body))
	return w.Code, w.Body.String()
}

func laneNames(lanes models.CaosLanes) string {
	var out []string
	for _, l := range lanes.Lanes {
		mark := ""
		if l.Senior {
			mark = "*"
		}
		out = append(out, fmt.Sprintf("%d:%s%s", l.Dripper, l.Name, mark))
	}
	return strings.Join(out, " ")
}

func TestCaosLanesOnDB(t *testing.T) {
	db, _ := openListenTestDB(t)
	f := newCaosFixture(t, db)
	hub := NewHub()
	f.caos.hub = hub
	today := caosDayString(time.Now())

	// まだ誰も替えていなければ、6 つとも担当者なし。配信もしない（つないだときに送らない）
	lanes := f.getLanes(t)
	if lanes.Day != today || len(lanes.Lanes) != caosDrippers || laneNames(lanes) != "1: 2: 3: 4: 5: 6:" || lanes.Lanes[0].UpdatedAt != nil {
		t.Fatalf("lanes = %+v", lanes)
	}
	if _, ok := caosLanesMessage(db, time.Now()); ok {
		t.Fatal("caos_lanes message without any lane")
	}
	// 前の日の担当者は今日に出ない
	if err := db.Create(&models.CaosLaneRow{Day: caosDayString(time.Now().AddDate(0, 0, -1)), Dripper: 1, Name: "昨日", Senior: true, UpdatedAt: time.Now()}).Error; err != nil {
		t.Fatal(err)
	}
	if got := laneNames(f.getLanes(t)); got != "1: 2: 3: 4: 5: 6:" {
		t.Fatalf("lanes with yesterday's row = %s", got)
	}

	// 交代：名前の前後の空白は落とす。上級生かは送られた値をそのまま持つ。配信は今日の 6 つ全部
	lanes = f.mustPutLane(t, 1, "  山田 ", true)
	if got := laneNames(lanes); got != "1:山田* 2: 3: 4: 5: 6:" || lanes.Lanes[0].UpdatedAt == nil {
		t.Fatalf("after put = %s (%+v)", got, lanes.Lanes[0])
	}
	msg := nextBroadcast(t, hub)
	if msg.Type != WSMessageTypeCaosLanes || msg.CaosLanes == nil || laneNames(*msg.CaosLanes) != "1:山田* 2: 3: 4: 5: 6:" {
		t.Fatalf("broadcast = %+v", msg)
	}
	f.mustPutLane(t, 2, "佐藤", false)
	nextBroadcast(t, hub)
	// 同じドリッパーをもう一度替えると上書き
	f.mustPutLane(t, 2, "鈴木", false)
	nextBroadcast(t, hub)

	// 入れ替え：名前と上級生かをいっしょに入れ替える。担当者なしのドリッパーとも入れ替えられる
	code, body := f.swapLanes(t, 1, 2)
	if code != http.StatusOK || laneNames(decodeLanes(t, []byte(body))) != "1:鈴木 2:山田* 3: 4: 5: 6:" {
		t.Fatalf("swap = %d: %s", code, body)
	}
	nextBroadcast(t, hub)
	if code, body := f.swapLanes(t, 2, 6); code != http.StatusOK || laneNames(decodeLanes(t, []byte(body))) != "1:鈴木 2: 3: 4: 5: 6:山田*" {
		t.Fatalf("swap with an empty lane = %d: %s", code, body)
	}
	nextBroadcast(t, hub)

	// 空きにする：上級生の印も外す
	if got := laneNames(f.mustPutLane(t, 6, " ", true)); got != "1:鈴木 2: 3: 4: 5: 6:" {
		t.Fatalf("after clearing = %s", got)
	}
	nextBroadcast(t, hub)
	// 空きにしても行は残り、つないだときに送る
	if msg, ok := caosLanesMessage(db, time.Now()); !ok || laneNames(*msg.CaosLanes) != "1:鈴木 2: 3: 4: 5: 6:" {
		t.Fatalf("caos_lanes message = %+v, %v", msg, ok)
	}

	// 形の違うリクエストは 400 で、何も変えない
	if code, _ := f.putLane(t, 7, "山田", false); code != http.StatusBadRequest {
		t.Fatalf("dripper 7 = %d, want 400", code)
	}
	if code, _ := f.putLane(t, 1, strings.Repeat("あ", caosMaxLaneName+1), false); code != http.StatusBadRequest {
		t.Fatalf("too long name = %d, want 400", code)
	}
	if code, _ := f.putLane(t, 1, strings.Repeat("あ", caosMaxLaneName), false); code != http.StatusOK {
		t.Fatalf("name of %d letters = %d, want 200", caosMaxLaneName, code)
	}
	nextBroadcast(t, hub)
	for _, pair := range [][2]int{{1, 1}, {0, 2}, {1, 7}} {
		if code, _ := f.swapLanes(t, pair[0], pair[1]); code != http.StatusBadRequest {
			t.Fatalf("swap %v = %d, want 400", pair, code)
		}
	}
	noBroadcast(t, hub)
}

func TestCaosSeniorOnlyCupsOnDB(t *testing.T) {
	db, _ := openListenTestDB(t)
	f := newCaosFixture(t, db)
	// 限定かは種類の senior_only で決める（名前は見ない）
	special := models.ItemType{Name: "special-" + uuid.NewString(), DisplayName: "特別", SeniorOnly: true}
	geisha := models.Item{Name: "ゲイシャ", Abbr: "ゲ", ItemType: special}
	if err := db.Create(&geisha).Error; err != nil {
		t.Fatal(err)
	}
	o1 := f.createOrder(t, 1, line(geisha))
	// 指名は明細のドリッパーの番号（dripper）。2 杯目の明細は番号の無い古い自由記述だけ（指名なし）
	o2 := f.createOrder(t, 2, caosLine{items: []models.Item{geisha}, dripper: intPtr(2), assignee: strPtr("山田さん")},
		caosLine{items: []models.Item{geisha}, assignee: strPtr("5")})
	o3 := f.createOrder(t, 3, line(f.blend))
	card1, card2 := uuid.New(), uuid.New()

	// どのドリッパーにも担当者がいなければ、限定はどこにも置けない。限定でないカップは置ける
	if code, body := f.put(t, write(ids(o1.OrderCups[0]), unassigned, placed(3, 1, card1, false))); code != http.StatusUnprocessableEntity || !strings.Contains(body, "上級生") {
		t.Fatalf("limited cup without a senior = %d: %s", code, body)
	}
	f.mustPut(t, write(ids(o3.OrderCups[0]), unassigned, placed(3, 3, uuid.New(), false)))

	// 上級生のドリッパーには置ける（抽出を始めるのも同じ）
	f.mustPutLane(t, 3, "山田", true)
	f.mustPutLane(t, 4, "佐藤", false)
	f.mustPut(t, write(ids(o1.OrderCups[0]), unassigned, placed(3, 1, card1, false)))
	// 上級生でないドリッパーへは移せない
	if code, _ := f.put(t, write(ids(o1.OrderCups[0]), f.state(t, o1.OrderCups[0].ID), placed(4, 1, card1, false))); code != http.StatusUnprocessableEntity {
		t.Fatalf("move a limited cup to a non-senior = %d, want 422", code)
	}

	// 担当者を上級生でない人に替えても、待っていた限定のカードはそのドリッパーに残り、同じドリッパーの中では順番を変えられる
	f.mustPutLane(t, 3, "鈴木", false)
	if cup := f.cup(t, o1.OrderCups[0].ID); cup.Dripper == nil || *cup.Dripper != 3 {
		t.Fatalf("limited cup after the change = %+v", cup)
	}
	f.mustPut(t, write(ids(o1.OrderCups[0]), f.state(t, o1.OrderCups[0].ID), placed(3, 0.5, card1, false)))
	// 未割当に戻すのもできる
	f.mustPut(t, write(ids(o1.OrderCups[0]), f.state(t, o1.OrderCups[0].ID), toUnassigned))
	// 入れ替えで上級生がいるドリッパーが変われば、置ける先もいっしょに変わる
	if code, body := f.swapLanes(t, 3, 4); code != http.StatusOK {
		t.Fatalf("swap = %d: %s", code, body)
	}
	if code, _ := f.put(t, write(ids(o1.OrderCups[0]), unassigned, placed(4, 1, card1, false))); code != http.StatusUnprocessableEntity {
		t.Fatalf("limited cup to 4 (佐藤 → 鈴木) = %d, want 422", code)
	}

	// 指名（2nd）の限定のカップ：指名の 2nd の担当者が上級生でなければ、どこにも置けない
	// （2nd は限定で、ほかは指名で断る。上級生の 1st・3rd でも置けない）
	f.mustPutLane(t, 1, "高橋", true)
	f.mustPutLane(t, 2, "小林", false)
	for d := 1; d <= caosDrippers; d++ {
		code, body := f.put(t, write(ids(o2.OrderCups[0]), unassigned, placed(d, 2, card2, false)))
		if code != http.StatusUnprocessableEntity {
			t.Fatalf("nominated limited cup to %d (2nd is not a senior) = %d, want 422", d, code)
		}
		want := "指名のあるカップは 2 番"
		if d == 2 {
			want = "上級生"
		}
		if !strings.Contains(body, want) {
			t.Fatalf("nominated limited cup to %d: %s, want %q", d, body, want)
		}
	}
	// 担当者を上級生に替えれば 2nd にだけ置ける（ほかの上級生のドリッパーへは指名で断る）
	f.mustPutLane(t, 2, "伊藤", true)
	if code, body := f.put(t, write(ids(o2.OrderCups[0]), unassigned, placed(1, 2, card2, false))); code != http.StatusUnprocessableEntity || !strings.Contains(body, "指名") {
		t.Fatalf("nominated limited cup to 1st (a senior) = %d: %s", code, body)
	}
	f.mustPut(t, write(ids(o2.OrderCups[0]), unassigned, placed(2, 2, card2, true)))
	// 番号の無い自由記述だけの古い明細の限定のカップは指名なし：上級生のドリッパーならどこにでも置ける（1st の高橋）
	f.mustPut(t, write(ids(o2.OrderCups[1]), unassigned, placed(1, 2, uuid.New(), false)))
}

func TestCaosLanesReachOtherInstances(t *testing.T) {
	db, dsn := openListenTestDB(t)
	f := newCaosFixture(t, db)
	// 同じプロセスの中ではインスタンスの ID が同じなので、送った通知は別の接続で受けて確かめる
	other := listenAsOtherInstance(t, dsn, caosLanesChangedChannel)
	f.mustPutLane(t, 2, "山田", true)
	expectNotification(t, other, caosLanesChangedChannel)
	if code, _ := f.swapLanes(t, 2, 3); code != http.StatusOK {
		t.Fatalf("swap = %d", code)
	}
	expectNotification(t, other, caosLanesChangedChannel)

	// ほかのインスタンスで替わったら、通知を受けて今日の担当者を読み直して配る。つないだときにも配り直す
	hub := NewHub()
	h := NewOrderHandler(db, hub, nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go h.ListenChanges(ctx, dsn)
	got := map[WSMessageType]WSMessage{}
	for range 2 {
		msg := nextBroadcast(t, hub)
		got[msg.Type] = msg
	}
	if msg, ok := got[WSMessageTypeCaosLanes]; !ok || laneNames(*msg.CaosLanes) != "1: 2: 3:山田* 4: 5: 6:" {
		t.Fatalf("broadcasts when listening = %+v", got)
	}
	noBroadcast(t, hub)

	if err := db.Model(&models.CaosLaneRow{}).Where("day = ? AND dripper = 3", caosDayString(time.Now())).
		Updates(map[string]any{"name": "佐藤", "senior": false}).Error; err != nil {
		t.Fatal(err)
	}
	notifyStateFromOtherInstance(t, db, caosLanesChangedChannel)
	if msg := nextBroadcast(t, hub); msg.Type != WSMessageTypeCaosLanes || laneNames(*msg.CaosLanes) != "1: 2: 3:佐藤 4: 5: 6:" {
		t.Fatalf("broadcast = %+v", msg)
	}
	noBroadcast(t, hub)

	// 自分が送った通知では配り直さない
	notifyCaosLanesChanged(db)
	noBroadcast(t, hub)
}

func TestPendingChangesCaosLanes(t *testing.T) {
	q := newPendingChanges()
	q.add(caosLanesChangedChannel, instanceID)
	if s := q.take(); s.caosLanes {
		t.Fatal("own notification was queued")
	}
	q.add(caosLanesChangedChannel, uuid.NewString())
	q.add(caosLanesChangedChannel, uuid.NewString())
	if s := q.take(); !s.caosLanes || s.allOrders || s.masterState || s.cashierState || len(s.orderIDs) != 0 {
		t.Fatalf("take() = %+v; want caos lanes only", s)
	}
	q.addAll()
	if s := q.take(); !s.caosLanes {
		t.Fatalf("take() after addAll = %+v; want caos lanes", s)
	}
}
