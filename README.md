# 毎日の食事メモ報告（Google Sheets → GitHub Actions → Surge）

Googleスプレッドシート（**1行=1食**）から前日分（JST）を集計し、`dist/index.html` を生成して Surge に公開します。

## 1) Google Cloud（サービスアカウント）準備

### A. サービスアカウント作成
- GCPでプロジェクトを用意
- **Google Sheets API** を有効化
- サービスアカウントを作成し、**鍵（JSON）** を発行

### B. スプレッドシートを共有
- 対象スプレッドシートを開く
- サービスアカウントの `client_email`（例: `xxx@yyy.iam.gserviceaccount.com`）を **閲覧者** で共有

## 2) スプレッドシートの形式（ヘッダー）

1行目はヘッダー行にしてください（**必須**: `timestamp`, `meal_type`）。

推奨ヘッダー例:
- `timestamp`: 例 `2026/05/08 07:30` / ISO文字列でも可
- `meal_type`: `morning|noon|evening|snack`（日本語もある程度吸収します）
- `items`: 文字列（改行/カンマ区切り）または JSON配列（例: `[{"name":"卵","calories":80}]`）
- `calories`: 数字（任意）
- `memo`: メモ（任意）
- `photo_url`: 画像URL（任意）
- `protein_g`,`fat_g`,`carbs_g`,`fiber_g`,`salt_g`,`water_l`: 数字（任意）
- `tags`: カンマ/空白区切り（任意）

## 3) GitHub Secrets（必須）

リポジトリの `Settings → Secrets and variables → Actions` に以下を登録します。

### 必須
- `GOOGLE_SERVICE_ACCOUNT_JSON`: サービスアカウント鍵JSON（ファイル内容をそのまま貼り付け）
- `SHEETS_ID`: スプレッドシートID
- `SHEETS_RANGE`: 例 `meals!A:Z`
- `SURGE_TOKEN`: Surgeのトークン
- `SURGE_DOMAIN`: Surge公開ドメイン（例: `my-meal-report.surge.sh`）

### 任意（目標値の調整）
未設定でもデフォルトが入りますが、Secretsを置くと上書きできます。
- `CALORIE_GOAL`（例: `2000`）
- `PROTEIN_GOAL_G`（例: `90`）
- `FAT_GOAL_G`（例: `60`）
- `CARBS_GOAL_G`（例: `270`）
- `FIBER_GOAL_G`（例: `21`）
- `SALT_GOAL_G`（例: `7.5`）
- `WATER_GOAL_L`（例: `2.25`）

## 4) GitHub Actions 実行

ワークフロー: [`.github/workflows/daily-meal-report.yml`](.github/workflows/daily-meal-report.yml)

- `workflow_dispatch`（手動実行）に対応
- `schedule` は **06:00 JST**（UTCでは `21:00`）で、**前日分**を生成します

## 5) ローカル実行（任意）

```bash
npm install
npm run build
```

以下の環境変数を設定してから:

```bash
SHEETS_ID=...
SHEETS_RANGE="meals!A:Z"
GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account", ... }'
npm run run:daily
```

生成物は `dist/index.html` です。

