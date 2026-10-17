package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"

	"cafeore-pos/api/internal/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// 書き出し中に新しいログが届いても、3表は同じ時点のものを読む。
// 全件をメモリに積まず一時ファイルに作り、完成してから返す（途中失敗のJSONを保存させない）。
func (h *CaosHandler) ExportCaosLogs(c *gin.Context) {
	file, err := os.CreateTemp("", "caos-logs-*.json")
	if err != nil {
		c.JSON(500, gin.H{"error": "書き出しファイルを作成できませんでした"})
		return
	}
	defer func() {
		// 応答後の一時ファイルの後始末。失敗しても送信済みの応答は変更できない。
		_ = file.Close()
		_ = os.Remove(file.Name())
	}()
	now := h.now().UTC()
	err = h.db.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		if _, err := fmt.Fprintf(file, `{"exportedAt":%q,"entries":`, now.Format("2006-01-02T15:04:05.999999999Z07:00")); err != nil {
			return err
		}
		if err := writeCaosExportRows[models.CaosClientLog](tx, file, "at, tab_id, sequence"); err != nil {
			return err
		}
		if _, err := io.WriteString(file, `,"operations":`); err != nil {
			return err
		}
		if err := writeCaosExportRows[models.CaosOperation](tx, file, "recorded_at, id"); err != nil {
			return err
		}
		if _, err := io.WriteString(file, `,"cups":`); err != nil {
			return err
		}
		if err := writeCaosExportRows[models.CaosOperationCup](tx, file, "operation_id, unit_id"); err != nil {
			return err
		}
		_, err := io.WriteString(file, "}\n")
		return err
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		c.JSON(500, gin.H{"error": "ログを書き出せませんでした"})
		return
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		c.JSON(500, gin.H{"error": "書き出しファイルを読めませんでした"})
		return
	}
	name := "caos-logs-" + now.Format("20060102-150405") + ".json"
	c.Header("Content-Type", "application/json; charset=utf-8")
	c.Header("Content-Disposition", `attachment; filename="`+name+`"`)
	http.ServeContent(c.Writer, c.Request, name, now, file)
}

func writeCaosExportRows[T any](tx *gorm.DB, writer io.Writer, order string) error {
	var model T
	rows, err := tx.Model(&model).Order(order).Rows()
	if err != nil {
		return err
	}
	defer func() { _ = rows.Close() }()
	if _, err := io.WriteString(writer, "["); err != nil {
		return err
	}
	first := true
	encoder := json.NewEncoder(writer)
	for rows.Next() {
		var row T
		if err := tx.ScanRows(rows, &row); err != nil {
			return err
		}
		if !first {
			if _, err := io.WriteString(writer, ","); err != nil {
				return err
			}
		}
		first = false
		if err := encoder.Encode(row); err != nil {
			return err
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	_, err = io.WriteString(writer, "]")
	return err
}
