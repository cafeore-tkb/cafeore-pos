#!/usr/bin/env bash
# このビルドの PR 番号とコミットを決めて、GITHUB_OUTPUT の形（pr=<番号>、commit=<SHA>）で
# 標準出力に出す。POS のトップページに、画面と API がどの PR・コミットのビルドかを出すのに使う。
#
#   - PR（pull_request）: その PR の番号と、PR の head のコミット。GITHUB_SHA は
#     main とのテスト用のマージコミットで、PR のコミット一覧に無いので使わない
#   - main への push・手動実行: GITHUB_SHA と、それをマージコミットに持つ PR の番号。
#     API で引けなければ、コミットの件名の末尾の (#<番号>) から取る。どちらも無ければ空
#
# 番号が引けなくてもデプロイは止めない（空で出す）。
#
# 使い方: build-info.sh
# 環境変数: GH_TOKEN, GITHUB_REPOSITORY, GITHUB_EVENT_NAME, GITHUB_SHA,
#           PR_NUMBER と PR_HEAD_SHA（pull_request のときだけ）
# api-build.yml と pos-deploy-workers.yml が使う。
set -uo pipefail

if [ "$GITHUB_EVENT_NAME" = "pull_request" ]; then
  pr="${PR_NUMBER:-}"
  commit="${PR_HEAD_SHA:-$GITHUB_SHA}"
else
  commit="$GITHUB_SHA"
  pr=$(gh api "repos/$GITHUB_REPOSITORY/commits/$commit/pulls" \
    --jq "map(select(.merge_commit_sha == \"$commit\")) | .[0].number // empty") || pr=""
  if [ -z "$pr" ]; then
    pr=$(git log -1 --format=%s "$commit" | sed -nE 's/.*\(#([0-9]+)\)$/\1/p') || pr=""
  fi
fi

# 画面と API にそのまま焼くので、形の違うものは捨てる
case "$pr" in
  ''|*[!0-9]*) pr="" ;;
esac
case "$commit" in
  ''|*[!0-9a-f]*) commit="" ;;
esac

echo "PR: ${pr:-（不明）}、コミット: ${commit:-（不明）}" >&2
echo "pr=$pr"
echo "commit=$commit"
