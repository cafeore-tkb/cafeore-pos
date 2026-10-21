/* Illustrator自身で8ページのSVGを読み込み、8アートボードの.aiを保存する。
 * ExtendScript互換のためES3で記述。既存のファイル・開いている書類は変更しない。
 */
(() => {
  var PAGE_COUNT = 8;
  var WIDTH = (297 / 25.4) * 72;
  var HEIGHT = (210 / 25.4) * 72;
  var GAP = 36;
  var source = null;
  var output = null;
  var report = [];
  var previousDocument = app.documents.length ? app.activeDocument : null;
  var ownFolder = new File($.fileName).parent;
  var folder = new File(ownFolder.fsName + "/page-01.svg").exists
    ? ownFolder
    : Folder.selectDialog(
        "解凍したpage-01.svg～page-08.svgのフォルダーを選んでください"
      );
  if (!folder) return;

  function pageFile(index) {
    return new File(
      folder.fsName + "/page-" + (index < 10 ? "0" : "") + index + ".svg"
    );
  }

  function uniqueOutput() {
    var suffix = "";
    var index = 1;
    var candidate;
    do {
      candidate = new File(
        folder.fsName + "/CaOS-iPad-Manual" + suffix + ".ai"
      );
      index++;
      suffix = "-" + index;
    } while (candidate.exists);
    return candidate;
  }

  function hasFontFamily() {
    for (var i = 0; i < app.textFonts.length; i++) {
      if (/Noto\s*Sans\s*JP/i.test(app.textFonts[i].family)) return true;
    }
    return false;
  }

  function ensureTextIsEditable(doc, index) {
    if (doc.textFrames.length === 0) {
      throw new Error(
        index +
          "ページ目に編集可能な文字がありません。読み込み結果を確認してください。"
      );
    }
    for (var t = 0; t < doc.textFrames.length; t++) {
      var characters = doc.textFrames[t].characters;
      for (var c = 0; c < characters.length; c++) {
        if (!/\S/.test(characters[c].contents)) continue;
        var family = characters[c].characterAttributes.textFont.family;
        if (!/Noto\s*Sans\s*JP/i.test(family)) {
          throw new Error(
            index +
              "ページ目でフォントが「" +
              family +
              "」へ置換されています。完全なNoto Sans JPをインストールし、Illustratorを再起動してください。"
          );
        }
      }
    }
  }

  try {
    for (var i = 1; i <= PAGE_COUNT; i++) {
      if (!pageFile(i).exists)
        throw new Error(
          pageFile(i).name +
            "がありません。8枚のSVGが同じフォルダーに必要です。"
        );
    }
    // 既に開いている元SVGを変更・破棄しない。読み込み前に全件確認する。
    for (var d = 0; d < app.documents.length; d++) {
      var openPath = "";
      try {
        openPath = app.documents[d].fullName.fsName.toLowerCase();
      } catch (untitledError) {}
      for (var check = 1; check <= PAGE_COUNT; check++) {
        if (openPath === pageFile(check).fsName.toLowerCase()) {
          throw new Error(
            pageFile(check).name +
              "は既に開かれています。必要な変更を保存して閉じてから、もう一度実行してください。"
          );
        }
      }
    }
    if (!hasFontFamily()) {
      throw new Error(
        "完全なNoto Sans JPをインストールし、Illustratorを再起動してください。https://fonts.google.com/noto/specimen/Noto+Sans+JP"
      );
    }

    output = app.documents.add(DocumentColorSpace.RGB, WIDTH, HEIGHT);
    output.artboards[0].artboardRect = [0, 0, WIDTH, -HEIGHT];
    output.layers[0].name = "01ページ";

    for (var page = 1; page <= PAGE_COUNT; page++) {
      var left = ((page - 1) % 4) * (WIDTH + GAP);
      var top = -Math.floor((page - 1) / 4) * (HEIGHT + GAP);
      var rect = [left, top, left + WIDTH, top - HEIGHT];
      var layer;
      if (page === 1) {
        layer = output.layers[0];
      } else {
        output.artboards.add(rect);
        layer = output.layers.add();
        layer.name = (page < 10 ? "0" : "") + page + "ページ";
      }
      output.artboards[page - 1].name =
        (page < 10 ? "0" : "") + page + "ページ";
      output.activeLayer = layer;
      source = app.open(pageFile(page));
      ensureTextIsEditable(source, page);
      var sourceRect = source.artboards[0].artboardRect;
      if (
        Math.abs(sourceRect[2] - sourceRect[0] - WIDTH) > 1 ||
        Math.abs(sourceRect[1] - sourceRect[3] - HEIGHT) > 1
      ) {
        throw new Error(page + "ページ目のサイズがA4横ではありません。");
      }
      var textCount = source.textFrames.length;
      // Illustratorがリンク画像として読み込んだ場合も、書類に埋め込む。
      for (var p = source.placedItems.length - 1; p >= 0; p--)
        source.placedItems[p].embed();
      var roots = [];
      for (var item = 0; item < source.pageItems.length; item++) {
        if (source.pageItems[item].parent.typename === "Layer")
          roots.push(source.pageItems[item]);
      }
      if (roots.length === 0)
        throw new Error(page + "ページ目の内容を取得できません。");
      var dx = left - sourceRect[0];
      var dy = top - sourceRect[1];
      // rootsは上から下の重なり順。末尾へ順に複製して元の順番を保つ。
      for (var root = 0; root < roots.length; root++) {
        var copied = roots[root].duplicate(layer, ElementPlacement.PLACEATEND);
        copied.translate(dx, dy);
      }
      report.push(page + "ページ: 読み込み時のテキスト " + textCount + "個");
      source.close(SaveOptions.DONOTSAVECHANGES);
      source = null;
    }

    output.activate();
    output.artboards.setActiveArtboardIndex(0);
    output.selection = null;
    if (output.placedItems.length !== 0)
      throw new Error("外部リンク画像が残っています。保存せず停止しました。");
    var file = uniqueOutput();
    var options = new IllustratorSaveOptions();
    options.pdfCompatible = true;
    options.compressed = true;
    options.embedLinkedFiles = true;
    output.saveAs(file, options);
    var log = new File(file.fsName.replace(/\.ai$/i, "-import-report.txt"));
    log.encoding = "UTF-8";
    if (log.open("w")) {
      log.writeln("Illustratorで作成: " + file.fsName);
      log.writeln("A4横・8アートボード・ページごとに別レイヤー");
      log.writeln(report.join("\n"));
      log.writeln(
        "テキストが存在し、Noto Sans JPで表示されることを確認しました。"
      );
      log.writeln(
        "SVG読み込みで段落が行単位へ分かれる可能性があります。テキストボックスの単位・折り返し・見た目は保存した書類で確認してください。"
      );
      log.close();
    }
    alert(
      "8ページを1つのIllustrator書類へ保存しました。\n" +
        file.fsName +
        "\n\n各ページの表示と文字のまとまりを確認してください。読み込み時の文字数は隣のimport-report.txtに記録しました。"
    );
  } catch (error) {
    if (source) {
      try {
        source.close(SaveOptions.DONOTSAVECHANGES);
      } catch (closeError) {}
    }
    if (output) {
      try {
        output.close(SaveOptions.DONOTSAVECHANGES);
      } catch (discardError) {}
    }
    if (previousDocument) {
      try {
        previousDocument.activate();
      } catch (restoreError) {}
    }
    alert(
      "統合を中止しました。\n" +
        error.message +
        "\n元のSVGと既存のファイルは変更していません。"
    );
  }
})();
