# 仮想待合室（Virtual Waiting Room）プロトタイプ 実装計画

- 作成日: 2026-08-29
- 対象リポジトリ: `asakaicode/playgrounds`
- 実装ルート: `features/virtual-waiting-room/`
- 作業ブランチ: `feat/virtual-waiting-room`
- ステータス: **承認済み（実装未着手 / rev.2）**

## 1. 目的とゴール

アクセス集中時のスパイクを吸収する「仮想待合室」の挙動を、ローカル環境で**目で見て検証できる**最小構成として再現する。

**ゴール**

- 保護対象ページ（`/purchase`）へのアクセスを、入場トークン（JWT）の有無でインターセプトできる
- Redis を用いた整理番号の採番・進行・入場判定が動作する
- 発売前の「プレキュー（事前待合室）」→ 発売開始時の**ランダムシャッフル一斉採番**が動作する
- 発売開始後の新規アクセスは最後尾から FIFO で採番される
- 全体像とプロダクション（Cloudflare/AWS 等）との対応関係をドキュメント化する

**非ゴール（今回はやらない）**

- 本物の CDN / エッジワーカーへのデプロイ
- 実決済処理、在庫管理、ユーザー認証基盤
- 水平スケール、Redis Cluster、可用性設計（ドキュメントで言及するに留める）
- Bot 検知の実装（プレキューが Bot 対策に効く理屈は `architecture.md` で解説のみ）

## 2. ディレクトリ構成

```
playgrounds/
├── docs/
│   └── plans/
│       └── 2026-08-29-virtual-waiting-room-impl.md   # 本書
└── features/
    └── virtual-waiting-room/
        ├── README.md                  # 起動方法・検証手順
        ├── package.json               # フィーチャ全体の依存とスクリプト
        ├── tsconfig.base.json         # 共通のコンパイラ設定
        ├── eslint.config.js
        ├── docker-compose.yml
        ├── .env.example
        ├── .gitignore                 # dist/, node_modules/
        ├── shared/
        │   └── types.ts               # API 契約の型（server / public 双方が import）
        ├── docs/
        │   └── architecture.md        # 学習用の解説ドキュメント
        ├── server/
        │   ├── Dockerfile             # マルチステージ（build → runtime）
        │   ├── tsconfig.json          # module: NodeNext / target: ES2023
        │   ├── src/
        │   │   ├── index.ts           # Express 起動・ルーティング束ね
        │   │   ├── config.ts          # env を zod で検証して型付き設定に
        │   │   ├── redis.ts           # Redis クライアント（型付きラッパ）
        │   │   ├── queue.ts           # 採番・状態取得・入場判定のドメインロジック
        │   │   ├── token.ts           # JWT 発行・検証（EntryTokenPayload 型）
        │   │   ├── routes/
        │   │   │   ├── waitingRoom.ts
        │   │   │   ├── purchase.ts
        │   │   │   └── admin.ts
        │   │   ├── middleware/
        │   │   │   └── gate.ts        # CDN/エッジ相当のインターセプト
        │   │   ├── lua/
        │   │   │   ├── join.lua
        │   │   │   └── startSale.lua
        │   │   └── worker.ts          # 案内番号を進めるワーカー
        │   ├── scripts/
        │   │   └── load.ts            # 疑似ユーザーを大量投入する検証スクリプト
        │   └── test/
        │       ├── queue.test.ts
        │       └── flow.test.ts       # 統合テスト（Redis 実接続）
        └── public/
            ├── index.html             # 商品ページ（入口）
            ├── waiting-room.html      # 待合室 UI
            ├── purchase.html          # 入場後の購入ページ
            ├── admin.html             # 発売開始・リセット操作用の管理画面
            ├── css/style.css
            ├── tsconfig.json          # lib: DOM / module: ESNext
            ├── src/
            │   ├── waiting-room.ts    # ポーリングと UI 更新
            │   ├── admin.ts
            │   └── api.ts             # fetch ラッパ（shared/types.ts で型付け）
            └── dist/                  # esbuild の出力（gitignore、HTML から参照）
```

> `shared/` は当初のディレクトリ指定への追加項目。サーバとフロントで同じ API 型を使い回すことが TypeScript 化の主目的の一つなので、ここに置く。不要であれば `server/src/types.ts` に寄せて相対 import する形にも変更可能。

## 3. 技術スタック

| 領域 | 採用 | 理由 |
|---|---|---|
| 言語 | **TypeScript 5.9（`strict: true`）** | 全レイヤで統一。API 契約を型で固定する |
| ランタイム | Node.js 22 (LTS) | ESM / `--watch` が安定 |
| バックエンド | Express 5 | 要件指定。ルーティングが薄く読みやすい |
| データストア | Redis 7（`redis` v4 クライアント） | 要件指定。アトミック操作と Lua が使える |
| トークン | JWT（HS256 / `jsonwebtoken`） | 要件指定。エッジで検証できる形の再現 |
| バリデーション | zod | env とリクエストボディを実行時に検証し、型を導出する |
| フロント | **Vanilla TypeScript**（フレームワークなし） | 要件の「Vanilla JS」を TS 化。挙動が追いやすい |
| フロントビルド | esbuild | `public/src/*.ts` → `public/dist/*.js` に即時バンドル |
| サーバビルド | `tsc`（本番）/ `tsx`（開発時の直接実行） | 型チェックとビルドを分離しない |
| テスト | Vitest | TS をそのまま実行でき、統合テストの前後処理が書きやすい |
| Lint | ESLint + typescript-eslint | 型情報つきルールで安全側に寄せる |
| 実行環境 | Docker + docker-compose | `docker compose up` 一発で起動 |

**tsconfig の主要方針**（`tsconfig.base.json`）

- `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`
- `verbatimModuleSyntax: true`（型 import を明示）
- サーバは `module: NodeNext` / `moduleResolution: NodeNext`、フロントは `module: ESNext` / `lib: ["ES2023", "DOM"]`

**npm スクリプト**

| コマンド | 内容 |
|---|---|
| `npm run dev` | `tsx watch server/src/index.ts` と esbuild の watch を並行実行 |
| `npm run build` | `tsc -p server` + `esbuild public/src/*.ts --bundle --outdir=public/dist` |
| `npm run typecheck` | `tsc --noEmit` をサーバ／フロント両方で実行 |
| `npm run lint` | ESLint |
| `npm test` | Vitest（Redis に接続する統合テストを含む） |

## 4. 共有型（`shared/types.ts`）

API の契約をここに集約し、サーバのレスポンス生成とフロントの受け取りを同じ型で縛る。

```ts
export type WaitingState = 'prequeue' | 'waiting' | 'admitted';
export type WorkerMode = 'RATE' | 'CAPACITY';

export interface JoinResponse {
  state: WaitingState;
  userId: string;
  position: number | null;   // prequeue のときは null
  saleStarted: boolean;
}

export interface StatusResponse {
  state: WaitingState;
  position: number | null;
  serving: number;
  peopleAhead: number | null;
  etaSeconds: number | null;
  pollAfterMs: number;       // 次のポーリングまでの待ち時間をサーバが指示
}

export interface AdminStats {
  saleStarted: boolean;
  prequeueSize: number;
  issued: number;
  serving: number;
  activeSessions: number;
  admitRatePerSec: number;
  workerMode: WorkerMode;
}

export interface StartSaleResponse { assigned: number; startedAt: string; }

export interface EntryTokenPayload { sub: string; pos: number; iat: number; exp: number; }

export interface ApiError { error: string; message: string; }
```

## 5. データモデル（Redis キー設計）

| キー | 型 | 用途 |
|---|---|---|
| `wr:sale:started` | String (`"0"`/`"1"`) | 発売開始フラグ |
| `wr:prequeue` | Set | 発売前に到着したユーザー ID の集合（**順序を持たせない**のが肝） |
| `wr:counter:issued` | String (数値) | 発行済み整理番号の最大値。FIFO 採番は `INCR` |
| `wr:counter:serving` | String (数値) | 現在の案内番号。この番号以下が入場可能 |
| `wr:user:{userId}` | Hash | `{ position, state, joinedAt, admittedAt }` |
| `wr:active` | Sorted Set | 入場中セッション（score = 有効期限）。容量制御に使う |

- Redis から返る値は `string | null` なので、`queue.ts` に `parseUserRecord()` 等のパーサを置き、**境界で必ず型付きオブジェクトへ変換**する（`as` による握りつぶしはしない）。
- ユーザー ID はサーバが発行し Cookie（`wr_uid`, HttpOnly）で保持。リロードしても整理番号を失わない。
- `wr:user:{userId}` には TTL（既定 2 時間）を設定し、放置エントリを自然消滅させる。

## 6. API 仕様

| メソッド / パス | レスポンス型 | 概要 |
|---|---|---|
| `GET /` | – | 商品ページ |
| `GET /purchase` | – | **保護対象**。`gate` が JWT を検証。無効なら `302 → /waiting-room` |
| `GET /waiting-room` | – | 待合室 UI |
| `POST /waiting-room/join` | `JoinResponse` | 発売前ならプレキューへ、発売後なら整理番号を採番 |
| `GET /waiting-room/status` | `StatusResponse` | ポーリング先。順番到達時に JWT を Cookie にセット |
| `POST /admin/start-sale` | `StartSaleResponse` | プレキューをシャッフルして一斉採番 |
| `POST /admin/reset` | `AdminStats` | 全キー削除して初期状態へ |
| `GET /admin/stats` | `AdminStats` | 観測用 |

`state: "admitted"` の場合のみ `Set-Cookie: wr_token=<JWT>` を返す。JWT の有効期限は既定 10 分（`ENTRY_TOKEN_TTL`）。

## 7. 動作フロー

### 7-1. 基本フロー（発売開始後）

1. ユーザーが `/purchase` にアクセス
2. `gate` ミドルウェアが `wr_token` Cookie を検証 → 無効なら `/waiting-room` へ 302
3. 待合室 UI が `POST /waiting-room/join` を叩き、`INCR wr:counter:issued` で整理番号を取得
4. UI が `GET /waiting-room/status` を約 3 秒間隔でポーリングし、順位・待ち人数・推定時間を表示
5. ワーカーが `wr:counter:serving` を進め、`position <= serving` になった時点でサーバが JWT を発行
6. UI が `/purchase` へ自動遷移。今度は `gate` を通過して購入ページが表示される

### 7-2. プレキュー（事前待合室）フロー

1. `wr:sale:started == "0"` の間、`join` は**整理番号を発行せず** `SADD wr:prequeue {userId}` のみ行う
2. UI は順位なしの「まもなく発売開始です」表示に切り替える（早く来ても得しないことを明示）
3. 管理画面から `POST /admin/start-sale`
   - `SMEMBERS wr:prequeue` で全 ID を取得
   - **Fisher–Yates でシャッフル**
   - 先頭から `1..N` の整理番号を各 `wr:user:{id}` に一括書き込み
   - `wr:counter:issued = N`、`wr:sale:started = "1"`、`wr:prequeue` を削除
   - 一連の処理は **Lua スクリプト**で実行し、途中参加による番号衝突を防ぐ
4. 以降の新規アクセスは `INCR wr:counter:issued` により **N+1 から FIFO** で採番される

> シャッフルは Lua 内で `redis.call('TIME')` を種にした `math.random` で行う。件数が大きい場合に備え、`start-sale` はチャンク単位（既定 1000 件）で `HSET` を回す。Lua スクリプトは `server/src/lua/*.lua` を起動時に読み込み、`loadScript` / `evalSha` を薄い型付き関数（`runJoinScript(userId): Promise<JoinResult>` 等）でラップする。

### 7-3. ワーカー処理

`server/src/worker.ts` を **docker-compose の別サービス**として起動し、一定間隔で案内番号を進める。`WORKER_MODE` で 2 モードを切り替える。

- `RATE`（既定）: `ADMIT_RATE_PER_SEC` 人／秒のペースで `INCRBY wr:counter:serving`
- `CAPACITY`: `ZCARD wr:active` が `MAX_ACTIVE_SESSIONS` を下回る分だけ進める（実運用に近いモデル）

期限切れの入場セッションは `ZREMRANGEBYSCORE wr:active` で毎ティック掃除する。

## 8. フロントエンド

- **待合室 UI**: 整理番号 / 前に並んでいる人数 / 現在の案内番号 / 推定待ち時間 / プログレスバー
- `api.ts` に `getStatus(): Promise<StatusResponse>` 等を置き、`shared/types.ts` の型で応答を受ける
- サーバが返す `pollAfterMs` に従って `setTimeout` で再ポーリング（`setInterval` は使わない。応答遅延時に多重リクエストになるため）
- `document.visibilityState === 'hidden'` の間はポーリング間隔を延ばす
- 失敗時は指数バックオフ + ジッタで再試行し、「再接続中」を表示
- プレキュー中は順位を出さず、カウントダウンと「順番は発売開始時にランダムに決まります」という説明を表示
- **管理画面**: 発売開始 / リセット / 統計の自動更新。検証時のコントロールパネルとして使う
- HTML からは `<script type="module" src="/dist/waiting-room.js">` を読み込む（バンドル済み JS）

## 9. Docker 構成

```yaml
services:
  redis:    # redis:7-alpine, healthcheck 付き
  app:      # server/Dockerfile, 3000 番を公開, redis に依存
  worker:   # 同一イメージ, command: node dist/worker.js
```

**`server/Dockerfile`（マルチステージ）**

1. `builder`: 依存をインストール → `npm run build`（`tsc` + `esbuild`）
2. `runner`: `node:22-alpine` に `dist/`、`public/`、本番依存のみをコピー。非 root ユーザーで実行

開発時は `docker-compose.override.yml` でソースをマウントし、`tsx watch` で動かす（型エラーが起動を止めないよう、型チェックは `npm run typecheck` として分離）。

`.env.example`: `PORT`, `REDIS_URL`, `JWT_SECRET`, `ENTRY_TOKEN_TTL`, `ADMIT_RATE_PER_SEC`, `MAX_ACTIVE_SESSIONS`, `WORKER_MODE`, `POLL_INTERVAL_MS`, `PREQUEUE_MAX`。`config.ts` が zod でパースし、不足時は**起動を失敗させる**。

## 10. 実装ステップ

| # | ステップ | 成果物 |
|---|---|---|
| 0 | **TS ツールチェーン整備** | `package.json`, `tsconfig.base.json` と各 tsconfig, ESLint, esbuild スクリプト |
| 1 | 足場づくり | ディレクトリ、Dockerfile、docker-compose、`.env.example` |
| 2 | 共有型と設定 | `shared/types.ts`, `config.ts`（zod）, `redis.ts`, `GET /healthz` |
| 3 | 採番ロジック | `queue.ts`, `join.lua`、ユニットテスト |
| 4 | トークンとゲート | `token.ts`, `middleware/gate.ts`, `/purchase` の保護 |
| 5 | 待合室 API | `routes/waitingRoom.ts` |
| 6 | ワーカー | `worker.ts`（RATE / CAPACITY 両モード） |
| 7 | プレキュー | `startSale.lua`, `routes/admin.ts`, 発売前分岐 |
| 8 | フロントエンド | HTML / CSS / `public/src/*.ts` / esbuild 出力 |
| 9 | 検証スクリプトとテスト | `scripts/load.ts`, `test/flow.test.ts` |
| 10 | ドキュメント | `docs/architecture.md`, `README.md` |

各ステップは独立コミットとし、メッセージは `feat(vwr): ...` 形式に揃える。

## 11. 検証シナリオ（受け入れ基準）

1. **ゲート**: トークンなしで `/purchase` → `/waiting-room` にリダイレクトされる
2. **FIFO**: 発売開始後に 3 人が順に join → 整理番号が 1, 2, 3 の順で付く
3. **入場**: ワーカーが `serving` を進めると、番号の小さい順に `admitted` へ遷移し `/purchase` が開ける
4. **プレキュー**: 発売前に 100 人が join → 全員 `position: null` / `state: "prequeue"`
5. **シャッフル**: `start-sale` 後、100 人に 1〜100 が重複なく付与され、**参加順と整理番号に相関がない**（`load.ts` が順位相関係数を出力し 0 付近であることを確認）
6. **後続 FIFO**: 発売開始後に来た 5 人が 101〜105 を取得する
7. **トークン期限**: `ENTRY_TOKEN_TTL` 経過後の `/purchase` は再び待合室へ戻される
8. **リセット**: `/admin/reset` 後、すべてのカウンタが初期値に戻る

2〜7 は Vitest の統合テストとしても記述し、`docker compose run --rm app npm test` で回せるようにする。

## 12. `docs/architecture.md` の構成

1. 全体像（Mermaid のシーケンス図とコンポーネント図）
2. **プロトタイプ ↔ プロダクションの対応表**

   | プロトタイプ | Cloudflare | AWS |
   |---|---|---|
   | `middleware/gate.ts` | Workers / Waiting Room | CloudFront Functions + Lambda@Edge |
   | Express の待合室 API | Workers + Durable Objects | API Gateway + Lambda |
   | Redis カウンタ | Durable Object / Workers KV | ElastiCache / DynamoDB Atomic Counter |
   | `worker.ts` | Cron Triggers | EventBridge Scheduler + Lambda |
   | 入場 JWT | Signed Cookie（エッジ検証） | CloudFront Signed Cookie / Lambda@Edge JWT 検証 |
   | 静的な待合室ページ | Cloudflare Pages | S3 + CloudFront |

3. なぜ「エッジで弾く」ことが重要か（オリジンに到達する前に切り離す）
4. **プレキューの意義**
   - F5 連打・先行接続で有利にならないため、開始前のスパイクそのものが起きにくい
   - 「早く並ぶ Bot」の投資対効果を消す（先着有利が消えるので、Bot は台数を増やす戦略に切り替えざるを得ず、そこは別レイヤの検知で対処できる）
   - 発売時刻の瞬間ピークを、シャッフル後の一定レート消化に均す＝オリジンの必要容量を平準化できる
   - 公平性の観点（回線速度・地理的距離による有利不利の排除）
5. トレードオフと未対応事項
   - トークン共有・リンク流出（実運用ではデバイス紐付けや一回限りトークンが必要）
   - 複数 ID 取得による水増し（レート制限、Turnstile/CAPTCHA、デバイス指紋との併用）
   - ポーリング vs SSE/WebSocket のコスト比較
   - Redis 単一障害点と、Durable Object のような単一ライター設計への発展

## 13. ブランチ戦略と PR フロー

1. `main` には直接コミットしない
2. 作業ブランチ: **`feat/virtual-waiting-room`**（`main` から分岐）
3. コミット粒度は §10 のステップ単位
4. 完了後に `main` 向けの PR を作成し、**依頼者のレビュー承認後にマージ**
5. 以後の修正は `fix/xxx`、ドキュメント追記は `docs/xxx` を切る

## 14. リスクと留意点

| リスク | 対応 |
|---|---|
| ポーリング自体がオリジンを圧迫する | `pollAfterMs` をサーバ側から動的に指示。待ち人数が多いほど間隔を延ばす |
| `start-sale` 実行中に新規参加が来て番号が衝突 | Lua でアトミックに実行し、その間の `join` はプレキューに入れず待たせる |
| プレキュー件数が多いと `SMEMBERS` が重い | `SSCAN` + チャンク処理。`PREQUEUE_MAX` を超えたら警告ログ |
| Lua の戻り値が `any` になり型の恩恵が消える | スクリプト単位に戻り値パーサを書き、`unknown` → 型付きへ絞り込む |
| JWT の期限切れで購入途中に弾かれる | 入場時に `wr:active` へ登録し、購入中はハートビートで延長 |
| Redis のデータが再起動で消える | プロトタイプでは許容。`architecture.md` に論点として記載 |

## 15. 完了の定義

- `docker compose up` のみで全体が起動する
- `npm run typecheck` と `npm run lint` がエラーなしで通る
- §11 の 8 シナリオがすべて再現でき、Vitest が全件パスする
- `README.md` に検証手順が記載され、初見でも 5 分で挙動を確認できる
- `docs/architecture.md` が §12 の構成で書かれている
- `feat/virtual-waiting-room` から PR が作成され、レビュー可能な状態になっている
