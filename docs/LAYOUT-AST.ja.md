# uimodulay Layout AST — 仕様 v1(日本語)

*英語版 [LAYOUT-AST.md](LAYOUT-AST.md) が正本です。食い違いがあれば英語版に従います。スキーマ: [layout-ast.schema.json](layout-ast.schema.json)*

**Layout AST** は、描画済みの Web ページ 1 枚を解析した結果です。ページを「モジュール」の木として表し、
各ノードは計測した矩形と名前を持ち、コンテナは子の並べ方も持ちます。DOM の写しではなく、
デザイナーがそのページを描いたときの構造です。`div > div > div > h1` は 1 つの `Heading` になります。

文書は 2 種類あります。

| `format` | 内容 |
|---|---|
| `uimodulay/layout-ast` | 1 ページ、1 つのビューポート幅 |
| `uimodulay/layout-ast-set` | 同じページを複数幅で撮ったものと、幅間の配置変化 |

## 1. 語彙

独自語彙を作らず、既存の 3 つを合成しています。

| 軸 | フィールド | 出典 | 値 |
|---|---|---|---|
| ページ領域 | `role` | ARIA ランドマーク / 構造ロール | `document banner navigation main contentinfo complementary form search dialog article region list listitem table figure` |
| 配置 | `layout.mode` | Auto Layout / Column–Row–Grid | `stack row split grid flow` |
| 葉の内容 | `content` | DocLayNet 系の種別 | `heading text paragraph image icon logo link button input divider panel block backdrop` |

`type` は人間向けのモジュール名(PascalCase: `Header` `Hero` `Gallery` `Card` `Heading` …)で、**ラベル**です。
機械が分岐に使う安定した語彙は `role` `content` `layout` の 3 つで、`type` は表示用文字列として扱ってください。

### 1.1 ヒューリスティックが出す型

| 種別 | 型 |
|---|---|
| 領域 | `Page Header Nav Main Footer Sidebar Hero Section Feature Gallery CardGrid Form Search Dialog Article List Item Table Figure` |
| コンテナ | `Card Group TextBlock IconText IconRow` |
| 葉 | `Heading Text Paragraph Image ImageLink Icon Logo Brand Link Button Input Divider Panel Block Backdrop` |

`Frame` は出力に現れません。解析中にページの足場(Header/Main/Footer を包むだけの div)を示す印で、出力前に取り除かれます。

### 1.2 AI パスが追加しうる型

`Testimonial Pricing FAQ CTA Profile Stats Timeline Steps LogoRow Breadcrumb Pagination Badge Label`
および `ProductCard` `ArtistProfile` のような複合名。AI パスは**名前を変えるだけ**で、ノードの追加・移動・矩形の変更はしません。

## 2. 文書

```json
{
  "format": "uimodulay/layout-ast",
  "version": 1,
  "source": {
    "url": "https://playwright.dev/",
    "viewport": { "width": 1440, "height": 900 },
    "document": { "height": 2848 },
    "capturedAt": "2026-09-17T09:00:00.000Z",
    "generator": "uimodulay 0.1.0"
  },
  "root": { "id": 0, "type": "Page", "kind": "region", "role": "document", "…": "…" }
}
```

| フィールド | 意味 |
|---|---|
| `format` | `"uimodulay/layout-ast"` |
| `version` | 整数。破壊的変更で上がる(§6) |
| `source.url` | リダイレクト後の URL |
| `source.viewport` | 描画時のビューポート(CSS px) |
| `source.document.height` | その幅でのスクロール全高 |
| `source.capturedAt` | ISO 8601 |
| `source.generator` | 生成ツールとバージョン。AI パスを通すと `+ai` が付く |
| `root` | `Page` ノード |

AI パスを通した場合は `ai` オブジェクト(`{ relabeled, costUsd, durationMs, notes }`)が付きます。

## 3. ノード

```json
{
  "id": 7,
  "type": "Gallery",
  "kind": "region",
  "role": "region",
  "bounds": { "x": 60, "y": 1287, "width": 1320, "height": 383 },
  "layout": {
    "mode": "grid", "columns": 3, "rows": 2,
    "gap": 24, "rowGap": 32,
    "padding": { "top": 0, "right": 0, "bottom": 0, "left": 0 }
  },
  "source": { "tag": "section", "hints": ["ul"] },
  "children": [ { "id": 8, "type": "Card", "kind": "container", "…": "…" } ]
}
```

| フィールド | 対象 | 意味 |
|---|---|---|
| `id` | 全ノード | ルートを 0 とする行きがけ順の番号。1 文書内で安定。AI パスはこの番号でノードを指す |
| `type` | 全ノード | モジュール名。`/^[A-Z][A-Za-z]{1,30}$/` |
| `kind` | 全ノード | `children` が空なら `leaf`、`type` がロールに対応するなら `region`、それ以外は `container` |
| `role` | region | ARIA ランドマーク / 構造ロール(§1) |
| `content` | leaf | 葉の内容種別 |
| `bounds` | 全ノード | 撮影幅における**文書座標**(スクロール量込み)の CSS px。整数 |
| `layout` | 非 leaf | §4 |
| `text` | 一部 | そのノード自身の文字のプレビュー。80 文字以内、空白は畳む |
| `source.tag` | 全ノード | ラッパー圧縮を生き残った要素のタグ(小文字) |
| `source.hints` | 一部 | このノードに畳み込まれたラッパーの意味タグや `role:*`。外側から順 |
| `children` | 全ノード | 文書順(上から下、左から右)。葉では空 |

`Page` は常にルートで `role: "document"`、`bounds` は `{0, 0, viewport.width, document.height}` です。

### 3.1 content の種別

| `content` | 対象 | スケッチ表現 |
|---|---|---|
| `heading` | `h1`〜`h6` | 太い線 |
| `text` | 140 文字未満の自前テキスト | 細い線 |
| `paragraph` | 140 文字以上の自前テキスト | 細い線 |
| `image` | `img svg video canvas picture iframe`、または CSS 背景画像を持つ箱 | ×付きの箱 |
| `icon` | 48×48 px 以下の画像 | 丸 |
| `logo` | ヘッダー左 1/3 にあるリンク付き画像 | ×付きの箱 |
| `link` | 素の `a[href]` | 下線付きの線 |
| `button` | `button`、`role=button`、または余白と背景色を持つ短文リンク | 棒入りの箱 |
| `input` | `input select textarea` | 薄い箱 |
| `divider` | 高さ 4 px 以下・幅 60 px 以上の箱 | 線 |
| `panel` | 文字のない幅広の色付き箱 | 薄い箱 |
| `backdrop` | ビューポート幅の 90 % 超かつ 1.2 画面以上の高さ、ビューポート外にはみ出す、または面積 1.5 画面以上の画像 | 点線の枠 |
| `block` | それ以外 | 薄い箱 |

## 4. `layout`

| `mode` | 意味 | `columns` | `rows` | `gap` | `rowGap` |
|---|---|---|---|---|---|
| `stack` | 子がすべて別の視覚行 | – | n | 縦の間隔 | – |
| `row` | 視覚行が 1 つ | n | 1 | 横の間隔 | – |
| `split` | 2 つの子が横並びで各々親幅の 25 % 以上、または横方向に重ならない 2 つの子 | 2 | 1 | 横の間隔 | – |
| `grid` | 2 行以上、満杯の行はすべて同数 k ≥ 2、セル幅が平均の ±25 % 以内 | k | n | 横の間隔 | 縦の間隔 |
| `flow` | 上のどれでもない | – | n | – | – |

- **視覚行**は、縦方向の重なりが短いほうの高さの半分を超える子どうしをまとめたものです。
- `gap` は主軸方向で隣り合う子の距離の**中央値**。負にはなりません。
- `padding` はノードの `bounds` から子全体の外接矩形までの距離。負にはなりません。
- 子が 2 未満のコンテナは `mode: "stack"` で、個数は持ちません。

## 5. レスポンシブ・セット

```json
{
  "format": "uimodulay/layout-ast-set",
  "version": 1,
  "url": "https://astro.build/",
  "widths": [390, 820, 1440],
  "variants": [ { "width": 390, "ast": { "format": "uimodulay/layout-ast", "…": "…" } }, "…" ],
  "changes": [
    { "path": "Main / Section / Gallery “View Theme”", "type": "Gallery", "arrangement": ["stack", "grid 2", "grid 3"], "presence": false }
  ]
}
```

- `variants` は `widths` の順。各 `ast` は完全な `layout-ast` 文書です。
- `changes` は**最も広い**幅のコンテナ(深さ 3 まで)のうち、どこかの幅で配置が異なるものです。
  `arrangement[i]` は `widths[i]` に対応し、`"<mode>"`、`"<mode> <columns>"`、葉なら `content`、
  その幅で見つからなければ `"—"` です。`"—"` を含むとき `presence` は true。
- 幅をまたいだ対応付けは**指紋**で行います。ノード配下の葉テキストを先頭から 4 つ、各 24 文字に切って `|` で
  結んだものです。型名・ラッパー圧縮・兄弟順は幅で変わりますが、言葉は変わりません。文字を持たないモジュールは
  兄弟番号付きの型パス(`/Main#0/Section#2`)で代替し、指紋が重複するモジュールは対応付けしません。
- `path` は最広幅における型パスに、そのモジュール先頭の言葉を引用符付きで添えたものです。

## 6. 保証とバージョン

- `id` は 0 から行きがけ順で欠番なし。同じページを撮り直しても同じ番号になる保証はありません。
- 子の `bounds` が親の中に収まる保証はありません(はみ出し、負のマージン)。
- `children` は文書順で、`row`/`grid` ではこれが左→右・上→下でもあります。
- `version` は、フィールド名・必須項目・`mode` `role` `content` の値の意味が変わるときに上がります。
  任意フィールドの追加と新しい `type` 名は破壊的変更ではありません。
- uimodulay 以外の生成器は `source.generator` に自分の名前を入れてください。

## 7. 他システムへの対応

- **Figma**: `row`/`stack` → Auto Layout の方向、`gap` → アイテム間隔、`padding` → パディング、
  `grid` → 折り返し Auto Layout または Grid フレーム、`bounds` → 絶対配置フレーム。
- **アクセシビリティツリー**: `role` はすべて正規の ARIA ロールなので、Chrome の `Accessibility.getFullAXTree` と突き合わせできます。
- **MJML / メール**: `Section` → `mj-section`、`row`/`split` の子 → `mj-column`、葉 → `mj-text` `mj-image` `mj-button`。
- **VIPS / DocLayNet**: `content` は DocLayNet のラベル集合を Web 向けに絞って拡張したもの。`bounds` と `kind` で VIPS のブロック木が得られます。

## 8. 例

- `examples/playwright.dev.ast.json` — ドキュメントサイトのトップ(1440 px)
- `examples/mozilla.org.ast.json` — マーケティングページ(1440 px)
- `examples/astro.build.set.json` — 390 / 820 / 1440 px のレスポンシブ・セットと変化表

`test/schema.test.ts` がすべての例を `docs/layout-ast.schema.json` で検証します。
