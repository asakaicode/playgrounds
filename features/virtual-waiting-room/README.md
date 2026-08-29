# 仮想待合室（Virtual Waiting Room）プロトタイプ

アクセス集中時のスパイクを吸収する「仮想待合室」の挙動を、ローカル環境で
目で見て検証できる最小構成の実装です。設計の背景や本番環境（Cloudflare/AWS）
との対応関係は [`docs/architecture.md`](docs/architecture.md) を参照してください。

## 構成

- `server/` — Express 5 + Redis によるバックエンド（採番・入場判定・ワーカー）
- `public/` — Vanilla TypeScript のフロントエンド（待合室 UI / 管理画面）
- `shared/types.ts` — サーバとフロントで共有する API 契約の型

## 起動方法（Docker）

```bash
cd features/virtual-waiting-room
cp .env.example .env
docker compose up --build
```

- 商品ページ: http://localhost:3000/
- 管理画面: http://localhost:3000/admin
- Redis: `localhost:6379`

`docker-compose.override.yml` が自動的に適用され、開発時はソースをマウントして
`tsx watch` で起動します（型チェックは起動をブロックしません）。

## 検証手順（5分で挙動を確認する）

1. `docker compose up --build` で起動する
2. ブラウザで http://localhost:3000/ を開き、「購入手続きへ進む」を押す
   → まだ発売開始前なので待合室（プレキュー表示）に案内される
3. 別タブで http://localhost:3000/admin を開く
4. 管理画面で「発売開始」を押す
   → プレキューにいたユーザーがシャッフルされ、一斉に整理番号が振られる
5. 元のタブに戻ると、整理番号・前に並んでいる人数・推定待ち時間が表示される
6. `worker` サービスが自動的に案内番号（`serving`）を進めるので、しばらく
   待つと自動的に `/purchase` へ遷移する
7. 管理画面の「リセット」を押すと全カウンタが初期状態に戻る

同じ手順をブラウザの別プロファイル（シークレットウィンドウなど）で複数開けば、
複数ユーザーが同時に並ぶ様子や、シャッフル後に参加順と整理番号が無関係になる
ことを目視で確認できます。

## ローカル開発（Docker なし）

```bash
cd features/virtual-waiting-room
npm install
redis-server --port 6379 &   # 別途 Redis が必要
cp .env.example .env
npm run dev:server     # Express（tsx watch）
npm run dev:worker     # ワーカー（別ターミナル）
npm run dev:public     # esbuild watch（別ターミナル）
```

## npm スクリプト

| コマンド | 内容 |
|---|---|
| `npm run dev:server` / `dev:worker` / `dev:public` | 開発時の個別起動 |
| `npm run build` | サーバ（`tsc`）とフロント（`esbuild`）を本番用にビルド |
| `npm run typecheck` | サーバ／フロント双方の型チェック（`--noEmit`） |
| `npm run lint` | ESLint |
| `npm test` | Vitest（Redis 実接続の統合テストを含む） |
| `npm run load-test` | プレキュー→シャッフルの公平性を検証する負荷スクリプト |

`npm test` と `npm run load-test` は Redis への接続が必要です。ローカルに
Redis がある場合は `REDIS_URL=redis://localhost:6379 npm test` のように
環境変数で向き先を指定してください。

## 受け入れシナリオ

実装が満たすべき挙動は `docs/plans/2026-08-29-virtual-waiting-room-impl.md`
の §11 に整理されています。うち Vitest 化できるものは
`server/test/queue.test.ts`（採番ロジックの単体テスト）と
`server/test/flow.test.ts`（HTTP 経由の統合テスト）でカバーしています。

- ゲート: トークンなしで `/purchase` → `/waiting-room` にリダイレクトされる
- FIFO: 発売開始後に複数人が順に join → 整理番号が連番で付く
- 入場: `serving` が進むと番号の小さい順に `admitted` へ遷移し `/purchase` が開ける
- プレキュー: 発売前の join は全員 `position: null` / `state: "prequeue"`
- シャッフル: `start-sale` 後、参加順と整理番号に相関がない（`load-test` が相関係数を出力）
- 後続 FIFO: 発売開始後に来た人は `N+1` から採番される
- トークン期限: `ENTRY_TOKEN_TTL_SECONDS` 経過後は再び待合室へ戻される
- リセット: `/admin/reset` 後、すべてのカウンタが初期値に戻る

## 非ゴール

- 本物の CDN / エッジワーカーへのデプロイ
- 実決済処理、在庫管理、ユーザー認証基盤
- 水平スケール、Redis Cluster、可用性設計（`docs/architecture.md` で言及のみ）
- Bot 検知の実装（プレキューが Bot 対策に効く理屈は `docs/architecture.md` で解説のみ）
