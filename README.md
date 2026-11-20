# dsh-minimax-token-plan

Show the remaining **MiniMax Token Plan (M Plan)** quota right inside the
DeepSeek Harness composer — between the `token 用量` pill and the `上下文已用`
ring.

[中文说明](#中文说明)

![plugin badge](https://img.shields.io/badge/DeepSeek%20Harness-plugin-blue)

## What it does

- A slim quota pill in the session footer. It shows the **5-hour remaining**
  percentage by default.
- Click the pill to open a panel with the **5-hour** and **weekly** remaining
  quota, the reset countdown, a per-model breakdown and the settings.
- The default metric is configurable: `5-hour remaining`, `weekly remaining`,
  **lowest absolute tokens** or **lowest percentage**.
- The API key is **encrypted at rest**: it is sealed with AES-256-GCM using a
  non-extractable key that only ever lives in the local IndexedDB. The key
  never touches the plugin configuration, the profile file, or a log line.
- Requests only ever reach the official MiniMax hosts
  (`api.minimax.io` / `api.minimax.cn`).

## Install

### From the open plugin market

Add the [open plugin market](https://dshopen.org) index in
*Settings → Plugins → Discover*, search for **MiniMax Token Plan** and install.

### From GitHub

Add the bundle to your profile's `package.json` and patch it in:

```jsonc
// cordis.patch.yml
- insert:
    - id: minimax-token-plan
      name: 'dsh-minimax-token-plan'
```

```jsonc
// package.json
{
  "dependencies": {
    "dsh-minimax-token-plan": "github:Aujin/dsh-minimax-token-plan#<commit>"
  },
  "dsh": {
    "profile": {
      "bundles": ["dsh-minimax-token-plan"]
    }
  }
}
```

Restart DSH afterwards.

## Configure

Open the pill → **设置 / Settings**:

| Setting | Meaning |
| --- | --- |
| **API Key** | Your MiniMax M Plan key (`sk-cp-…`). Stored encrypted, never uploaded anywhere but MiniMax. |
| **服务区域 / Service region** | `自动检测` (probe both regions), `国际 api.minimax.io`, or `中国 api.minimax.cn`. |
| **默认显示 / Default metric** | `5 小时剩余`, `周剩余`, `绝对 token 最低`, `百分比最低`. |
| **刷新间隔 / Refresh interval** | How often the quota is re-read, in minutes (1–60, default 5). |

> The plan decides which numbers it can report: text plans usually expose
> **percentages only** for the five-hour and weekly windows, while image/video
> plans expose absolute counts. When the plan reports no absolute counts the
> "absolute lowest" metric shows `—` and the panel says so.

## How it works

- The quota comes from the official endpoint
  `GET {base}/v1/token_plan/remains` with `Authorization: Bearer <M Plan key>`.
- The `*_usage_count` fields changed meaning between MiniMax server versions
  (remaining vs. consumed). The plugin disambiguates them with the server
  percentage, exactly like the official `mmx quota` command does.
- The weekly percentage is boosted with `weekly_boost_permille` when the plan
  reports one, so a boosted plan can show more than 100%.

## Privacy

- The API key is stored **encrypted** (AES-256-GCM, non-extractable key) in the
  browser's IndexedDB for the DSH origin. It is never written into the DSH
  profile, the plugin configuration, or the session log.
- Only `api.minimax.io` and `api.minimax.cn` are contacted.
- No analytics, no third-party services.

## License

[MIT](LICENSE)
