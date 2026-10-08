package handlers

import (
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"cafeore-pos/api/internal/models"
)

// CaOS（ドリップ管制）のドリッパーの担当者（caos_lanes。models.CaosLaneRow）。日本時間の日付ごとに、ドリッパー 1〜6 の名前と、
// 交代した時点で上級生（限定を淹れられる人）だったか。
//
//   - GET /api/caos/lanes：今日の 6 つ
//   - PUT /api/caos/lanes/:dripper：交代（名前と上級生か。空なら担当者なし）。抽出中かどうかは見ず、待機のカードも動かさない
//   - POST /api/caos/lanes/swap：2 つのドリッパーの担当者を入れ替える
//
// 替えるのは CaOS の画面からだけ（sohosai-shift の予定は画面が候補に出すだけで、サーバーは読まない）。上級生かも画面が
// sohosai-shift の名簿で判定して送り、そのまま持つ。PUT /api/caos/cups は、限定のカップを置くときにこの値を確かめる（caos.go）。
//
// 変えたら今日の 6 つを {"type":"caos_lanes"} で全部の画面に配り、ほかのインスタンスへは caos_lanes_changed で知らせる
// （注文と同じ形。受けたインスタンスは DB から読み直して配る。order_listener.go）。

const (
	// 担当者が変わったことをインスタンス同士で知らせるチャンネル。通知の中身は "<送ったインスタンスの ID>"
	caosLanesChangedChannel = "caos_lanes_changed"
	// 担当者の名前の長さ（文字）の上限
	caosMaxLaneName = 40
	// 担当者の書き込みと、限定のカップを置く書き込みを順番にする advisory lock
	caosLanesLock = "caos:lanes"
)

// caosDayString は日本時間の日付（YYYY-MM-DD）。担当者はこの日ごとに持つ。
func caosDayString(now time.Time) string { return now.In(jst).Format(time.DateOnly) }

// loadCaosLanes は day の 6 つの担当者と、その日の行があったかを返す。
func loadCaosLanes(db *gorm.DB, day string) (models.CaosLanes, bool, error) {
	var rows []models.CaosLaneRow
	if err := db.Select("dripper", "name", "senior", "updated_at").
		Where("day = ?", day).Find(&rows).Error; err != nil {
		return models.CaosLanes{}, false, err
	}
	lanes := models.CaosLanes{Day: day, Lanes: make([]models.CaosLane, caosDrippers)}
	for i := range lanes.Lanes {
		lanes.Lanes[i] = models.CaosLane{Dripper: i + 1}
	}
	for _, r := range rows {
		if r.Dripper < 1 || r.Dripper > caosDrippers {
			continue
		}
		at := r.UpdatedAt
		lanes.Lanes[r.Dripper-1] = models.CaosLane{Dripper: r.Dripper, Name: r.Name, Senior: r.Senior && r.Name != "", UpdatedAt: &at}
	}
	return lanes, len(rows) > 0, nil
}

// caosLanesMessage は今日の担当者の配信。今日まだ誰も替えていなければ ok = false（送らない。画面は担当者なしのまま）。
func caosLanesMessage(db *gorm.DB, now time.Time) (WSMessage, bool) {
	lanes, found, err := loadCaosLanes(db, caosDayString(now))
	if err != nil {
		log.Println("failed to load caos lanes:", err)
		return WSMessage{}, false
	}
	if !found {
		return WSMessage{}, false
	}
	return WSMessage{Type: WSMessageTypeCaosLanes, CaosLanes: &lanes}, true
}

// broadcastCaosLanes は今日の担当者を読み直して、このインスタンスの画面へだけ配る（ほかのインスタンスからの通知でも使う）。
func broadcastCaosLanes(db *gorm.DB, hub *Hub, now time.Time) {
	_ = hub.Publish(func() (WSMessage, error) {
		msg, ok := caosLanesMessage(db, now)
		if !ok {
			return WSMessage{}, errors.New("no caos lanes")
		}
		return msg, nil
	})
}

// 担当者が変わったことをほかのインスタンスへ知らせる。
func notifyCaosLanesChanged(db *gorm.DB) {
	notifyChanged(db, caosLanesChangedChannel, instanceID)
}

func lockCaosLanes(tx *gorm.DB) error {
	return tx.Exec("SELECT pg_advisory_xact_lock(hashtext(?))", caosLanesLock).Error
}

func saveCaosLane(tx *gorm.DB, row models.CaosLaneRow) error {
	return tx.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "day"}, {Name: "dripper"}},
		DoUpdates: clause.AssignmentColumns([]string{"name", "senior", "updated_at"}),
	}).Create(&row).Error
}

func parseCaosDripper(c *gin.Context, raw string) (int, bool) {
	n, err := strconv.Atoi(raw)
	if err != nil || n < 1 || n > caosDrippers {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("ドリッパーは 1〜%d です", caosDrippers)})
		return 0, false
	}
	return n, true
}

// GET /api/caos/lanes - 今日の担当者
func (h *CaosHandler) GetCaosLanes(c *gin.Context) {
	lanes, _, err := loadCaosLanes(h.db, caosDayString(h.now()))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, lanes)
}

// PUT /api/caos/lanes/:dripper - 交代
func (h *CaosHandler) PutCaosLane(c *gin.Context) {
	dripper, ok := parseCaosDripper(c, c.Param("dripper"))
	if !ok {
		return
	}
	var req models.CaosLaneUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	name := strings.TrimSpace(req.Name)
	if utf8.RuneCountInString(name) > caosMaxLaneName {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("名前は %d 文字までです", caosMaxLaneName)})
		return
	}
	now := h.now()
	row := models.CaosLaneRow{Day: caosDayString(now), Dripper: dripper, Name: name, Senior: req.Senior && name != "", UpdatedAt: now}
	h.writeLanes(c, row.Day, func(tx *gorm.DB) error { return saveCaosLane(tx, row) })
}

// POST /api/caos/lanes/swap - 2 つのドリッパーの担当者を入れ替える
func (h *CaosHandler) SwapCaosLanes(c *gin.Context) {
	var req models.CaosLaneSwapRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	for _, n := range []int{req.First, req.Second} {
		if _, ok := parseCaosDripper(c, strconv.Itoa(n)); !ok {
			return
		}
	}
	if req.First == req.Second {
		c.JSON(http.StatusBadRequest, gin.H{"error": "同じドリッパーどうしは入れ替えられません"})
		return
	}
	now := h.now()
	day := caosDayString(now)
	h.writeLanes(c, day, func(tx *gorm.DB) error {
		lanes, _, err := loadCaosLanes(tx, day)
		if err != nil {
			return err
		}
		a, b := lanes.Lanes[req.First-1], lanes.Lanes[req.Second-1]
		for _, row := range []models.CaosLaneRow{
			{Day: day, Dripper: req.First, Name: b.Name, Senior: b.Senior, UpdatedAt: now},
			{Day: day, Dripper: req.Second, Name: a.Name, Senior: a.Senior, UpdatedAt: now},
		} {
			if err := saveCaosLane(tx, row); err != nil {
				return err
			}
		}
		return nil
	})
}

// writeLanes は担当者の書き込みを 1 つのトランザクションで行い、今日の 6 つを返して配る。
func (h *CaosHandler) writeLanes(c *gin.Context, day string, write func(tx *gorm.DB) error) {
	var lanes models.CaosLanes
	err := h.db.Transaction(func(tx *gorm.DB) error {
		if err := lockCaosLanes(tx); err != nil {
			return err
		}
		if err := write(tx); err != nil {
			return err
		}
		var err error
		lanes, _, err = loadCaosLanes(tx, day)
		return err
	})
	if err != nil {
		log.Printf("caos lanes: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, lanes)
	broadcastCaosLanes(h.db, h.hub, h.now())
	notifyCaosLanesChanged(h.db)
}

// ---------------------------------------------------------------- 限定のカップ（PUT /api/caos/cups から使う）

// caosSeniorDrippers は、限定のカップをほかのドリッパーへ置く書き込みがあれば、今日の担当者が上級生のドリッパーを返す
// （無ければ nil。読まない）。担当者の書き込みと入れ違わないよう、担当者のロックを共有で取ってから読む。
func caosSeniorDrippers(tx *gorm.DB, writes []caosWrite, seniorOnly map[uuid.UUID]bool, now time.Time) (map[int]bool, error) {
	need := false
	for _, w := range writes {
		if !caosMovesTo(w) {
			continue
		}
		for _, id := range w.cups {
			need = need || seniorOnly[id]
		}
	}
	if !need {
		return nil, nil
	}
	if err := tx.Exec("SELECT pg_advisory_xact_lock_shared(hashtext(?))", caosLanesLock).Error; err != nil {
		return nil, err
	}
	lanes, _, err := loadCaosLanes(tx, caosDayString(now))
	if err != nil {
		return nil, err
	}
	seniors := map[int]bool{}
	for _, l := range lanes.Lanes {
		seniors[l.Dripper] = l.Senior
	}
	return seniors, nil
}

// caosMovesTo は、カップをほかのドリッパーへ置く（未割当から置く・ドリッパーを移す）書き込みか。
// 同じドリッパーの中の順番の入れ替えは含めない（担当者を上級生でない人に替えても、待っていた限定のカードはそのドリッパーに残るので）。
func caosMovesTo(w caosWrite) bool {
	return w.after.Dripper != nil && !ptrEqual(w.before.Dripper, w.after.Dripper)
}

// checkSeniorOnly は、限定のカップを上級生でない担当者のドリッパーへ置こうとしていれば断る（422）。
func checkSeniorOnly(tx *gorm.DB, w caosWrite, cup *models.OrderCup, seniorOnly bool, seniors map[int]bool) error {
	if !seniorOnly || !caosMovesTo(w) || seniors[*w.after.Dripper] {
		return nil
	}
	return caosRule("限定のカップ（%s）は上級生のドリッパーにしか置けません（%d 番のドリッパーの担当者は上級生ではありません）",
		cupItemName(tx, cup), *w.after.Dripper)
}
