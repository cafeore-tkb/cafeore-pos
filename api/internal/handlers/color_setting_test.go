package handlers

import (
	"strings"
	"testing"

	"cafeore-pos/api/internal/models"
	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func validColorSettingRequest() models.ColorSettingUpsertRequest {
	return models.ColorSettingUpsertRequest{
		TargetType: models.ColorTargetTypeItemType,
		TargetId:   openapi_types.UUID(uuid.New()),
		Screen:     models.ColorScreenMaster,
		Color:      "#BFDBFE",
	}
}

func TestBuildColorSettingNormalizesColor(t *testing.T) {
	request := validColorSettingRequest()
	setting, err := buildColorSetting(request)
	if err != nil {
		t.Fatal(err)
	}
	if setting.Color != "#bfdbfe" || setting.TargetType != "ItemType" || setting.Screen != "master" || setting.TargetID != uuid.UUID(request.TargetId) {
		t.Fatalf("incorrect setting: %+v", setting)
	}
}

func TestBuildColorSettingRejectsInvalidRequests(t *testing.T) {
	cases := map[string]func(*models.ColorSettingUpsertRequest){
		"unknown target type": func(r *models.ColorSettingUpsertRequest) { r.TargetType = "Menu" },
		"unknown screen":      func(r *models.ColorSettingUpsertRequest) { r.Screen = "dashboard" },
		"nil target id":       func(r *models.ColorSettingUpsertRequest) { r.TargetId = openapi_types.UUID(uuid.Nil) },
		"missing hash":        func(r *models.ColorSettingUpsertRequest) { r.Color = "bfdbfe" },
		"short color":         func(r *models.ColorSettingUpsertRequest) { r.Color = "#fff" },
		"alpha channel":       func(r *models.ColorSettingUpsertRequest) { r.Color = "#bfdbfe80" },
		"not hex":             func(r *models.ColorSettingUpsertRequest) { r.Color = "#gggggg" },
		"color name":          func(r *models.ColorSettingUpsertRequest) { r.Color = "blue" },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			request := validColorSettingRequest()
			mutate(&request)
			if _, err := buildColorSetting(request); err == nil {
				t.Fatal("expected validation error")
			}
		})
	}
}

func TestUpsertColorSettingUpdatesOnlyColorOnConflict(t *testing.T) {
	db, err := gorm.Open(postgres.New(postgres.Config{DSN: "host=localhost dbname=unused", PreferSimpleProtocol: true}), &gorm.Config{DryRun: true, DisableAutomaticPing: true, SkipDefaultTransaction: true})
	if err != nil {
		t.Fatal(err)
	}
	setting, err := buildColorSetting(validColorSettingRequest())
	if err != nil {
		t.Fatal(err)
	}
	result := upsertColorSetting(db, &setting)
	if result.Error != nil {
		t.Fatal(result.Error)
	}
	sql := result.Statement.SQL.String()
	want := `ON CONFLICT ("target_type","target_id","screen") DO UPDATE SET "color"="excluded"."color","updated_at"="excluded"."updated_at"`
	if !strings.Contains(sql, want) {
		t.Fatalf("upsert must key on target and screen: %s", sql)
	}
}
