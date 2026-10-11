package models

import "github.com/google/uuid"

type OrderMenu struct {
	ID      uuid.UUID `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()"`
	OrderID uuid.UUID `gorm:"type:uuid;not null;index"`
	MenuID  uuid.UUID `gorm:"type:uuid;not null;index"`
	// 指名の自由記述（ラベルに印刷する文）。指名するときは Dripper が必須で、
	// これは空でもよい。番号より前の注文では、指名がここにだけ入っている
	Assignee *string
	// 指名したドリッパーの番号（1st〜6th は 1〜6）。指名しない明細は null
	Dripper   *int   `gorm:"check:dripper BETWEEN 1 AND 6"`
	MenuName  string `gorm:"not null"`
	UnitPrice int    `gorm:"not null"`

	Menu Menu `gorm:"foreignKey:MenuID;references:ID"`
}
