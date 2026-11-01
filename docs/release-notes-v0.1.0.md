# dsh-token-control v0.1.0

**English** — First public release. A DeepSeek Harness plugin that shows a per-turn token and cost readout, your DeepSeek CNY balance (with a staleness marker), and the current peak/off-peak window with a switch countdown, mounted in the row above the composer.

---

## 这个版本做了什么

在输入框正上方加一条读数带，一眼看到这一轮花了多少：

```
本轮 4,269,675 tok · ¥0.1042 · 入 4,261,985 / 出 7,690 · 命中 4,253,696 / 未命中 8,289 · 余额 ¥1.59 (刚刚) · 空闲 后进入高峰 15:00:59
```

| 能力 | 说明 |
|---|---|
| 每轮 token | 总 token、输入合计、输出、缓存命中、缓存未命中，**分开显示** |
| 金额 | 官方人民币价目表结算；**按每次调用发生的时刻**选峰/谷单价，一轮跨 12:00 或 18:00 不会被整体按某个时段计价 |
| 流式更新 | 分片到达即更新；provider 上报 usage 之前，输出是字符估算并标 `≈`，结算后替换为真值 |
| 余额 | `GET /user/balance` 取 CNY 钱包；刷新失败**保留上次读数**并标「已过期 + 最后更新时间」，不显示假数字 |
| 峰谷 | 北京时间周一至周五 09:00–12:00、14:00–18:00 为高峰（不含法定节假日）；其余含周末、节假日、调休上班的周末均为空闲（半价） |
| 切换提醒 | 切换前 ≤5 分钟倒计时变色；切换瞬间静默提示 3 秒，不弹窗、不打断输入 |
| 配置 | 余额刷新间隔走 DSH settings（默认 60s）；插件自己的设置页聚合每个 View 的挂载槽位与字段开关 |

## 安装

```sh
# npm
dsh plugin --profile <profile> add dsh-token-control

# GitHub
dsh plugin --profile <profile> add github:RitvaManner/dsh-token-control

# 本地目录（开发）
dsh plugin --profile <profile> add link:<仓库绝对路径>
```

装完刷新页面；设置 → **Token 监控** 可改挂载槽位（`conversation.input.dock` / `conversation.composer.dock`）与字段开关。

## 计费口径（请先读这段）

- **token 是真实值**：取自 DSH 会话日志里 provider 上报的 usage，不是按文本估算。
- **`inputTokens` 是「缓存未命中」那部分**，不是 prompt 总量。读数带里的「入」= 命中 + 未命中 + 缓存写；把 `inputTokens` 当总量会让每一轮带缓存的对话多算一倍以上。
- **金额是估算**：DeepSeek 只返回 token，不返回钱。估算 = Σ 每步（未命中 × 未命中单价 + 命中 × 命中单价 + 输出 × 输出单价），实际扣费以平台账单为准。
- **价目**：[DeepSeek 模型 & 价格（人民币）](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)，表版本 `DS_CNY_2026_11`。`deepseek-flash` 空闲 0.02 / 1 / 4，高峰 0.04 / 2 / 8；`deepseek-v4-pro` 空闲 0.15 / 4.5 / 13.5，高峰 0.30 / 9 / 27（元 / 百万 tokens）。表里没有的模型按 Flash 价估算并标记，不静默假装精确。
- **峰谷与节假日**：[国务院办公厅关于 2026 年部分节假日安排的通知](https://www.gov.cn/zhengce/content/202511/content_7047090.htm)（国办发明电〔2025〕7号），内置在独立 policy 文件里；未覆盖年份标「按工作日估算」。
- **余额**：`GET https://api.deepseek.com/user/balance`，密钥经 DSH credentials 读 `DEEPSEEK_API_KEY`，只放请求头，不写日志、不下发浏览器。

## 已知限制

1. **流式期间的输出 token 是估算**（`≈`）——DeepSeek 只在流末尾上报 usage，所以「流式中精确 token」物理上不存在。
2. **余额需要 `DEEPSEEK_API_KEY`**；只用 `deepseek-account` 登录、没有 API Key 时显示「未配置 API Key」，不会伪造数字。
3. **余额与模型消费不同源**：`/user/balance` 含赠金与 Search/Fetch 扣费；插件的差值校准做了平滑与夹紧，仍可能有残差。
4. **路由只绑定回环地址，但注册在 DSH `/api` 连接鉴权之外**：同机进程可读取快照（含余额，绝不含 key）。这与现有社区插件做法一致。
5. **与内置 usage 行并存**：读数带挂在 `conversation.input.dock`，不替换 DSH 自带的统计行。
6. **当前只有一个 View（读数带）**：新增 View = 新文件 + `views/index.json` 一行 + `pnpm build`，Host、ViewModel、其他 View 都不用改。

## 本版验证

- 47 条单元断言全通过：峰谷边界（周末 / 法定节假日 / 调休周六 / 周五 18:00 到周一 09:00 / 未覆盖年份）、价格表（峰谷半价、命中与未命中、别名、未知模型）、token 语义（`inputTokens` = 未命中）、ViewModel 字段白名单与旧字段兼容、余额失败保留旧值、客户端激活与 View 注册、架构依赖方向。
- 真实会话端到端：`10,103 tokens / ¥0.00094`，其中 `输入 10,063 = 命中 9,472 + 未命中 591`；金额按高峰价结算（`591×1 + 9472×0.02 + 40×4 = 940` 微元），而当时是空闲时段——证明「按调用时刻选单价」生效。
- 桌面 profile 实测：槽位 `conversation.input.dock` 注册为 `token-control:readout-bar`，设置页注册为 `dsh-token-control`，余额读到真实账户值。

## 升级说明

首版，无需迁移。若你之前装过开发期的 `dsh-token-monitor`，请先
`dsh plugin --profile <profile> remove dsh-token-monitor` 再装本包，否则会同时存在两行。

## 反馈

问题与建议请提到 <https://github.com/RitvaManner/dsh-token-control/issues>，附上 DSH 版本、平台与 `[dsh-token-control]` 开头的控制台日志会更快定位。
