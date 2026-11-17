# varelser-worker

HTTP で叩くと起きて 1 回だけ仕事をする、定期実行ボットの受け口です。
Render Free（カードなし・$0）に置く前提で、依存パッケージなしの Node 標準機能だけで書いてあります。

## エンドポイント

| パス | 認証 | 内容 |
|---|---|---|
| `GET /` | なし | 説明テキスト |
| `GET /health` | なし | 死活確認 JSON（起動時刻、実行回数、トークン設定有無） |
| `POST /run` | 必須 | ジョブを 1 回実行して結果を返す |
| `GET /run` | 必須 | POST と同じ（GET しかできない定期 ping 用） |
| `GET /runs` | 必須 | 直近 20 件の実行記録 |

## 認証

環境変数 `RUN_TOKEN` と一致するトークンを、次のどれかで送ります。

- ヘッダ `x-run-token: <token>`
- ヘッダ `Authorization: Bearer <token>`
- クエリ `?token=<token>`（GET のときだけ簡易用）

`RUN_TOKEN` が未設定の間、`/run` と `/runs` は 503 を返し、何も実行しません。
トークン自体はこのリポジトリには含まれていません（Render の環境変数でのみ設定）。

## 呼び出し例

```sh
curl https://<service>.onrender.com/health
curl -X POST -H "x-run-token: $RUN_TOKEN" https://<service>.onrender.com/run
```

## レーン: museum

`POST /run`（`?lane=museum` が既定）は Discord Museum 用の収集レーンです。

- 既存の Muse 側 Museum ジョブと同じ 55 フィードを取得し、同じ選定ルール（45日以内の新しい順、出典が重ならないよう優先）で最大 2 件を選び、Discord embed を組み立てます
- 記事 ID は既存コレクタと同じ方式（リンクの sha256 先頭 20 桁）なので、既存の seen.json と照合できます
- リクエストボディで `{ "excludeIds": ["<id>", ...] }` を渡すと、その ID を候補から除外します。既存ジョブが投稿済みのものを再び選ばないための仕組みです
- 環境変数 `DISCORD_MUSEUM_WEBHOOK_URL` が未設定の間は **dry-run** で、投稿せずに payload をレスポンスで返します。設定すると実際に投稿し、同一プロセス内では同じ記事を二度投稿しません
- 日本語への翻訳・要約（既存ジョブでは LLM が担当）は未搭載で、タイトルと概要はフィードの原文のままです

## 制約（Render Free）

- 15 分無通信でスピンダウンし、復帰に約 1 分かかります。常時接続のデーモンは置けません。
- 状態はメモリ内のみで、再起動・スピンダウンで消えます。永続化が要るデータは外部 DB へ。
- 現在のジョブはプレースホルダ（実行記録のみ）です。実際のボット処理は `server.js` の `runJob()` に差し込みます。
