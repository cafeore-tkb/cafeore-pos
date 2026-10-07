package caos

import (
	"errors"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// 練習用の盤面（実データテスト）。
//
// 本番の盤面と同じルール（Board：分け方・割当・次へ・統合・入れ直し・列の担当者・1つ戻す）を、本番とは別の盤面で動かす。
// 過去の注文（画面がビルドに入っている実績データから選んで送る）を、練習の時計に合わせて盤面に流す。
//
//   - 盤面は練習 1 回ごと（端末ごと）に 1 つ。表 caos_practices の 1 行に、盤面の全部（カード・列の担当者・注文・操作の記録）を
//     jsonb で持つ。本番の caos_drips・caos_lanes・caos_ops・orders には触らず、在庫・統計にも入らない
//   - 配信はしない（本番の WebSocket の {"type":"drips"} には混ぜない）。練習している画面が、応答の盤面をそのまま使う
//   - 時計は画面が持つ（一時停止・倍速は画面だけで決まる）。画面は操作や「進める」に練習の時刻（at）を付けて送り、
//     サーバーはその時刻までに来た注文を盤面に入れ、カードの開始・終了の時刻もその時刻で付ける。時刻は戻らない
//   - 注文が全部終わったら、その注文を準備完了にする（練習の盤面の中だけ。本番の注文の準備完了の処理は使わない）
//   - 片付け：画面が終わったら消す（DELETE）。放置された練習は、最後に触ってから PracticeTTL を過ぎたら、
//     次に練習を始めたときに消す。練習の数は PracticeMax までにして、超えたら古いものから消す

// PracticeTTL は、最後に触ってから練習の盤面を残しておく時間。
const PracticeTTL = 12 * time.Hour

// PracticeMax は、同時に残しておく練習の盤面の数。
const PracticeMax = 200

// 練習の長さの上限と、終わりの時刻のあとも続けられる時間（残ったカードを淹れ終えるため）
const (
	practiceMaxSpan  = 6 * time.Hour
	practiceOvertime = 3 * time.Hour
)

// 練習に送れる注文の数・1 注文の明細の数・1 明細の杯数・文字数の上限
const (
	practiceMaxOrders   = 3000
	practiceMaxLines    = 100
	practiceMaxQuantity = 100
	practiceMaxText     = 100
)

// 「1つ戻す」のために残しておく操作の記録の数（画面が戻すのは直前の操作だけ）
const practiceKeepOps = 30

// ErrPracticeNotFound は練習の盤面が無い（消えた・ID が違う）。
var ErrPracticeNotFound = errors.New("practice not found")

// PracticeLineInput は練習に送る注文の明細の 1 行（同じ商品が何杯か）。
type PracticeLineInput struct {
	// 商品を見分けるキー（実績データの商品の ID。無ければ名前）。同じキーは同じ商品として扱う（統合できるのは同じ商品どうし）
	ItemKey string `json:"item_key"`
	Name    string `json:"name"`
	// 商品の種類（hot・ice・iceOre・milk・others・limited など。POS の item_type の name と同じ）。milk と others は抽出しない
	Type     string `json:"type"`
	Price    int    `json:"price"`
	Quantity int    `json:"quantity"`
}

// PracticeOrderInput は練習に送る注文。
type PracticeOrderInput struct {
	OrderNo       int                 `json:"order_no"`
	CreatedAt     time.Time           `json:"created_at"`
	BillingAmount int                 `json:"billing_amount"`
	Lines         []PracticeLineInput `json:"lines"`
}

// PracticeLaneInput は練習を始めるときの列の担当者。
type PracticeLaneInput struct {
	Dripper int    `json:"dripper"`
	Name    string `json:"name"`
	Senior  bool   `json:"senior"`
}

// PracticeInput は練習を始めるときに送るもの。
type PracticeInput struct {
	// 練習の時間帯（過去の時刻）。注文はこの間のもの
	StartsAt time.Time            `json:"starts_at"`
	EndsAt   time.Time            `json:"ends_at"`
	Orders   []PracticeOrderInput `json:"orders"`
	// 列の担当者の初めの状態（任意）。練習の中で交代しても本番の列には響かない
	Lanes []PracticeLaneInput `json:"lanes"`
}

// PracticeItem は練習の盤面の商品。カードの明細の item_id はこの ID。
type PracticeItem struct {
	ID   string `json:"id"`
	Key  string `json:"key"`
	Name string `json:"name"`
	Type string `json:"type"`
}

// PracticeOrderLine は練習の注文の明細の 1 行。
type PracticeOrderLine struct {
	ItemID   string `json:"item_id"`
	Price    int    `json:"price"`
	Quantity int    `json:"quantity"`
}

// PracticeOrder は練習の注文。
type PracticeOrder struct {
	ID            string              `json:"id"`
	OrderNo       int                 `json:"order_no"`
	CreatedAt     time.Time           `json:"created_at"`
	BillingAmount int                 `json:"billing_amount"`
	Lines         []PracticeOrderLine `json:"lines"`
	// 練習の中で準備完了になった時刻（練習の時計）。まだなら null
	ReadyAt *time.Time `json:"ready_at"`
}

// PracticeState は画面に返す練習の盤面。
type PracticeState struct {
	ID       string    `json:"id"`
	StartsAt time.Time `json:"starts_at"`
	EndsAt   time.Time `json:"ends_at"`
	// 練習の時計（最後に画面から受け取った時刻）
	Now time.Time `json:"now"`
	// 盤面が変わるたびに 1 つ増える（画面が古い応答で上書きしないため）
	Version int            `json:"version"`
	Drips   []Drip         `json:"drips"`
	Lanes   []Lane         `json:"lanes"`
	Items   []PracticeItem `json:"items"`
	// もう届いた注文（作った順）
	Orders []PracticeOrder `json:"orders"`
	// 練習の注文の全部の数
	TotalOrders int `json:"total_orders"`
	// 次に届く注文の時刻。もう無ければ null（画面は時計がここを過ぎたら「進める」を送る）
	NextArrivalAt *time.Time `json:"next_arrival_at"`
}

// practiceOp は練習の盤面に残す操作の記録。
type practiceOp struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Record  OpRecord `json:"record"`
	Readied []string `json:"readied"`
	Undone  bool     `json:"undone"`
}

// practiceDoc は caos_practices の 1 行に持つ、練習の盤面の全部。
type practiceDoc struct {
	StartsAt time.Time `json:"starts_at"`
	EndsAt   time.Time `json:"ends_at"`
	Now      time.Time `json:"now"`
	// 盤面の時計が最後に出した時刻（1 マイクロ秒ずつは必ず進める。MonotonicClock と同じ）
	Clock   time.Time      `json:"clock"`
	Version int            `json:"version"`
	Items   []PracticeItem `json:"items"`
	// 練習の注文の全部（作った順）。Arrived 件目より前が、もう届いた注文
	Orders  []PracticeOrder `json:"orders"`
	Arrived int             `json:"arrived"`
	Drips   []Drip          `json:"drips"`
	Lanes   []Lane          `json:"lanes"`
	Ops     []practiceOp    `json:"ops"`
}

// PracticeRow は練習の盤面の行。
type PracticeRow struct {
	ID    uuid.UUID              `gorm:"type:uuid;primaryKey"`
	State jsonValue[practiceDoc] `gorm:"type:jsonb;not null"`
	// 作った時刻・最後に変えた時刻（本当の時刻。片付けに使う）
	CreatedAt time.Time `gorm:"not null;autoCreateTime:false"`
	UpdatedAt time.Time `gorm:"not null;index;autoUpdateTime:false"`
}

func (PracticeRow) TableName() string { return "caos_practices" }

// ---------------------------------------------------------------- 練習の盤面のルール（DB に触らない）

func cleanText(s string) string { return strings.TrimSpace(s) }

func tooLong(s string, n int) bool { return utf8.RuneCountInString(s) > n }

// newPracticeDoc は送られた注文から練習の盤面を作る。商品の ID はここで振る（キーごと）。
func newPracticeDoc(in PracticeInput, newID func() string) (*practiceDoc, error) {
	if in.StartsAt.IsZero() || in.EndsAt.IsZero() || !in.EndsAt.After(in.StartsAt) {
		return nil, invalid("練習の時間帯が正しくありません")
	}
	if in.EndsAt.Sub(in.StartsAt) > practiceMaxSpan {
		return nil, invalid("練習の時間帯は %d 時間までです", int(practiceMaxSpan.Hours()))
	}
	if len(in.Orders) > practiceMaxOrders {
		return nil, invalid("練習の注文は %d 件までです", practiceMaxOrders)
	}
	d := &practiceDoc{StartsAt: in.StartsAt.UTC(), EndsAt: in.EndsAt.UTC(), Now: in.StartsAt.UTC(), Items: []PracticeItem{}, Ops: []practiceOp{}}
	itemIDs := map[string]string{}
	for _, o := range in.Orders {
		if o.CreatedAt.Before(in.StartsAt) || o.CreatedAt.After(in.EndsAt) {
			return nil, invalid("練習の時間帯の外の注文があります")
		}
		if o.OrderNo < 0 || len(o.Lines) > practiceMaxLines {
			return nil, invalid("注文の中身が正しくありません")
		}
		order := PracticeOrder{ID: newID(), OrderNo: o.OrderNo, CreatedAt: o.CreatedAt.UTC(), BillingAmount: o.BillingAmount, Lines: []PracticeOrderLine{}}
		for _, l := range o.Lines {
			name, typ, key := cleanText(l.Name), cleanText(l.Type), cleanText(l.ItemKey)
			if key == "" {
				key = name
			}
			if name == "" || key == "" || l.Quantity < 1 || l.Quantity > practiceMaxQuantity ||
				tooLong(name, practiceMaxText) || tooLong(typ, practiceMaxText) || tooLong(key, practiceMaxText) {
				return nil, invalid("注文の明細が正しくありません")
			}
			id, ok := itemIDs[key]
			if !ok {
				id = newID()
				itemIDs[key] = id
				d.Items = append(d.Items, PracticeItem{ID: id, Key: key, Name: name, Type: typ})
			}
			order.Lines = append(order.Lines, PracticeOrderLine{ItemID: id, Price: l.Price, Quantity: l.Quantity})
		}
		d.Orders = append(d.Orders, order)
	}
	slices.SortStableFunc(d.Orders, func(a, b PracticeOrder) int { return a.CreatedAt.Compare(b.CreatedAt) })

	b := NewBoard(nil, nil, nil, nil)
	for _, l := range in.Lanes {
		if !isDripper(l.Dripper) {
			return nil, invalid("ドリッパーは 1〜6 です")
		}
		name := cleanText(l.Name)
		if tooLong(name, maxPersonName) {
			return nil, invalid("名前は %d 文字までです", maxPersonName)
		}
		b.lanes[l.Dripper] = Lane{Dripper: l.Dripper, Name: name, Senior: l.Senior && name != ""}
	}
	d.Lanes = b.Lanes()
	d.Drips = []Drip{}
	return d, nil
}

// clock は盤面の時計。練習の時刻（Now）を返し、同じ時刻が続くときは 1 マイクロ秒ずつ進める。
func (d *practiceDoc) clock() time.Time {
	t := d.Now.Truncate(time.Microsecond)
	if !t.After(d.Clock) {
		t = d.Clock.Add(time.Microsecond)
	}
	d.Clock = t
	return t
}

func (d *practiceDoc) itemByID() map[string]PracticeItem {
	m := make(map[string]PracticeItem, len(d.Items))
	for _, it := range d.Items {
		m[it.ID] = it
	}
	return m
}

// toOrder は練習の注文を、盤面が使う注文の形にする。
func (d *practiceDoc) toOrder(o PracticeOrder, items map[string]PracticeItem) Order {
	order := Order{ID: o.ID, OrderNo: o.OrderNo, CreatedAt: o.CreatedAt, Ready: o.ReadyAt != nil}
	for _, l := range o.Lines {
		it := items[l.ItemID]
		order.Lines = append(order.Lines, OrderLine{ItemID: it.ID, Name: it.Name, Abbr: it.Name, Type: it.Type, Quantity: l.Quantity})
	}
	return order
}

// board は練習の盤面（もう届いた注文と、カード・列の担当者）を Board にする。
func (d *practiceDoc) board() *Board {
	states := make([]OrderState, 0, d.Arrived)
	for _, o := range d.Orders[:d.Arrived] {
		states = append(states, OrderState{ID: o.ID, OrderNo: o.OrderNo, CreatedAt: o.CreatedAt, Ready: o.ReadyAt != nil})
	}
	b := NewBoard(d.Drips, states, d.clock, nil)
	b.LoadLanes(d.Lanes)
	return b
}

// advance は練習の時計を at まで進め、それまでに来た注文を盤面に入れる。時刻は戻らない（古い時刻なら今のまま）。
func (d *practiceDoc) advance(b *Board, cs *Changeset, at time.Time) error {
	if at.Before(d.StartsAt) || at.After(d.EndsAt.Add(practiceOvertime)) {
		return invalid("練習の時刻が時間帯の外です")
	}
	if at.After(d.Now) {
		d.Now = at.UTC()
	}
	items := d.itemByID()
	var arrived []Order
	for d.Arrived < len(d.Orders) && !d.Orders[d.Arrived].CreatedAt.After(d.Now) {
		arrived = append(arrived, d.toOrder(d.Orders[d.Arrived], items))
		d.Arrived++
	}
	if len(arrived) > 0 {
		b.IngestOrders(cs, arrived, false)
	}
	return nil
}

// apply は画面からの操作を 1 つ行う。undo（1つ戻す）は、練習の盤面に残した操作の記録で戻す。
// 操作の記録の ID（undo では空）を返す。ルールに合わなければ ErrInvalid（盤面は捨てるので、何も変わらない）。
func (d *practiceDoc) apply(b *Board, cs *Changeset, op Op, newID func() string) (string, error) {
	if op.Name == "undo" {
		i := slices.IndexFunc(d.Ops, func(p practiceOp) bool { return p.ID == op.OpID })
		if i < 0 {
			return "", invalid("戻す操作が見つかりません")
		}
		if d.Ops[i].Undone {
			return "", invalid("この操作はもう元に戻しています")
		}
		// この操作で付けた準備完了は外す（カードを戻すときの確かめでは、外した状態として扱う）
		for _, id := range d.Ops[i].Readied {
			if o, ok := b.Orders[id]; ok {
				o.Ready = false
			}
		}
		if err := b.Undo(cs, d.Ops[i].Record); err != nil {
			return "", err
		}
		d.Ops[i].Undone = true
		return "", nil
	}
	rec, err := b.ApplyRecorded(cs, op)
	if err != nil {
		return "", err
	}
	id := newID()
	d.Ops = append(d.Ops, practiceOp{ID: id, Name: op.Name, Record: rec, Readied: cs.Completed.List()})
	if len(d.Ops) > practiceKeepOps {
		d.Ops = slices.Clone(d.Ops[len(d.Ops)-practiceKeepOps:])
	}
	return id, nil
}

// save は Board の中身を練習の盤面に書き戻す。準備完了は盤面の注文の状態から付け外しする（付けた時刻は練習の時計）。
func (d *practiceDoc) save(b *Board, changed bool) {
	d.Drips = b.List()
	d.Lanes = b.Lanes()
	for i := range d.Orders[:d.Arrived] {
		o := &d.Orders[i]
		ready := b.Orders[o.ID] != nil && b.Orders[o.ID].Ready
		switch {
		case ready && o.ReadyAt == nil:
			at := d.Now
			o.ReadyAt = &at
		case !ready:
			o.ReadyAt = nil
		}
	}
	if changed {
		d.Version++
	}
}

func (d *practiceDoc) state(id string) PracticeState {
	s := PracticeState{
		ID: id, StartsAt: d.StartsAt, EndsAt: d.EndsAt, Now: d.Now, Version: d.Version,
		Drips: orEmpty(d.Drips), Lanes: orEmpty(d.Lanes), Items: orEmpty(d.Items),
		Orders: orEmpty(slices.Clone(d.Orders[:d.Arrived])), TotalOrders: len(d.Orders),
	}
	if d.Arrived < len(d.Orders) {
		at := d.Orders[d.Arrived].CreatedAt
		s.NextArrivalAt = &at
	}
	return s
}

// ---------------------------------------------------------------- PracticeStore

// PracticeStore は練習の盤面の保存。本番の盤面（Store）とは表も配信も分けてある。
type PracticeStore struct {
	db *gorm.DB
	// 本当の時刻（片付けに使う。練習の時計ではない）
	now   func() time.Time
	newID func() string
}

// NewPracticeStore は PracticeStore を作る。
func NewPracticeStore(db *gorm.DB) *PracticeStore {
	return &PracticeStore{db: db, now: time.Now, newID: func() string { return uuid.NewString() }}
}

// Create は練習の盤面を作る。先に、放置された練習の盤面を片付ける。
func (s *PracticeStore) Create(in PracticeInput) (PracticeState, error) {
	doc, err := newPracticeDoc(in, s.newID)
	if err != nil {
		return PracticeState{}, err
	}
	if _, err := s.Cleanup(); err != nil {
		return PracticeState{}, err
	}
	now := s.now()
	row := PracticeRow{ID: uuid.New(), State: jsonValue[practiceDoc]{*doc}, CreatedAt: now, UpdatedAt: now}
	if err := s.db.Create(&row).Error; err != nil {
		return PracticeState{}, err
	}
	return doc.state(row.ID.String()), nil
}

// Cleanup は、最後に触ってから PracticeTTL を過ぎた練習の盤面と、PracticeMax を超えた古い練習の盤面を消す。消した数を返す。
func (s *PracticeStore) Cleanup() (int64, error) {
	res := s.db.Where("updated_at < ?", s.now().Add(-PracticeTTL)).Delete(&PracticeRow{})
	if res.Error != nil {
		return 0, res.Error
	}
	// 新しく 1 つ作るので、残すのは PracticeMax - 1 まで
	old := s.db.Model(&PracticeRow{}).Select("id").Order("updated_at DESC").Offset(PracticeMax - 1)
	over := s.db.Where("id IN (?)", old).Delete(&PracticeRow{})
	if over.Error != nil {
		return 0, over.Error
	}
	return res.RowsAffected + over.RowsAffected, nil
}

func parsePracticeID(id string) (uuid.UUID, error) {
	u, err := uuid.Parse(id)
	if err != nil {
		return uuid.Nil, ErrPracticeNotFound
	}
	return u, nil
}

// Get は練習の盤面を読む（時計は進めない）。
func (s *PracticeStore) Get(id string) (PracticeState, error) {
	u, err := parsePracticeID(id)
	if err != nil {
		return PracticeState{}, err
	}
	var row PracticeRow
	if err := s.db.First(&row, "id = ?", u).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return PracticeState{}, ErrPracticeNotFound
		}
		return PracticeState{}, err
	}
	return row.State.V.state(id), nil
}

// update は練習の盤面を行ロックして読み、fn で変えて保存する。fn がエラーなら何も保存しない。
func (s *PracticeStore) update(id string, fn func(d *practiceDoc) error) (PracticeState, error) {
	u, err := parsePracticeID(id)
	if err != nil {
		return PracticeState{}, err
	}
	var out PracticeState
	err = s.db.Transaction(func(tx *gorm.DB) error {
		var row PracticeRow
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&row, "id = ?", u).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrPracticeNotFound
			}
			return err
		}
		doc := row.State.V
		if err := fn(&doc); err != nil {
			return err
		}
		if err := tx.Model(&row).Updates(map[string]any{"state": jsonValue[practiceDoc]{doc}, "updated_at": s.now()}).Error; err != nil {
			return err
		}
		out = doc.state(id)
		return nil
	})
	return out, err
}

// Advance は練習の時計を at まで進め、それまでに来た注文を盤面に入れる。
func (s *PracticeStore) Advance(id string, at time.Time) (PracticeState, error) {
	return s.update(id, func(d *practiceDoc) error {
		before := d.Now
		b := d.board()
		cs := &Changeset{}
		if err := d.advance(b, cs, at); err != nil {
			return err
		}
		d.save(b, !cs.Empty() || !d.Now.Equal(before))
		return nil
	})
}

// Apply は練習の時計を at まで進めてから、操作を 1 つ行う。操作の記録の ID（undo では空）と、操作のあとの盤面を返す。
func (s *PracticeStore) Apply(id string, at time.Time, op Op) (string, PracticeState, error) {
	var opID string
	state, err := s.update(id, func(d *practiceDoc) error {
		b := d.board()
		if err := d.advance(b, &Changeset{}, at); err != nil {
			return err
		}
		// 操作の変更は、注文が届いた変更と分けて数える（「1つ戻す」の記録に、届いたカードを入れない）
		var err error
		if opID, err = d.apply(b, &Changeset{}, op, s.newID); err != nil {
			return err
		}
		d.save(b, true)
		return nil
	})
	return opID, state, err
}

// Delete は練習の盤面を消す（無くてもエラーにしない）。
func (s *PracticeStore) Delete(id string) error {
	u, err := parsePracticeID(id)
	if err != nil {
		return nil
	}
	return s.db.Delete(&PracticeRow{}, "id = ?", u).Error
}
