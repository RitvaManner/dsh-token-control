# dsh-token-control

[![release](https://github.com/RitvaManner/dsh-token-control/actions/workflows/release.yml/badge.svg)](https://github.com/RitvaManner/dsh-token-control/actions/workflows/release.yml)
[![npm version](https://img.shields.io/npm/v/dsh-token-control.svg)](https://www.npmjs.com/package/dsh-token-control)
[![npm downloads](https://img.shields.io/npm/dm/dsh-token-control.svg)](https://www.npmjs.com/package/dsh-token-control)
[![license](https://img.shields.io/npm/l/dsh-token-control.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D22-339933)](https://nodejs.org)
[![dsh](https://img.shields.io/badge/dsh-%3E%3D0.2.0-3964fe)](https://github.com/deepseek-ai/deepseek-harness)
[![GitHub release](https://img.shields.io/github/v/release/RitvaManner/dsh-token-control.svg)](https://github.com/RitvaManner/dsh-token-control/releases)

**每轮 token 与金额读数 + DeepSeek 人民币余额 + 峰谷时段与切换提醒** —— DeepSeek Harness 插件，挂在输入框上方。

[功能](#功能) · [架构](#架构) · [安装](#安装) · [开发](#开发隔离环境) · [配置](#配置) · [安全](#安全) · [发布说明](https://github.com/RitvaManner/dsh-token-control/blob/main/docs/release-notes-v0.1.0.md)

Host / Client 强制分离；PricingStrategy、BalanceProvider、PeakPeriodProvider、View 都是可替换接口；UI 完全可插拔。

> 状态：v0.1.0 —— 已在 desktop profile 实机渲染并验证（真实会话数字 + 实时余额），47 条断言通过。设计：[docs/design-v1.md](https://github.com/RitvaManner/dsh-token-control/blob/main/docs/design-v1.md) · 验证记录：[docs/verify-v1.md](https://github.com/RitvaManner/dsh-token-control/blob/main/docs/verify-v1.md)。

---

## 功能

- **每轮读数**：总 token、输入合计、输出、缓存命中、缓存未命中，分开显示。
- **金额**：价格表结算，按「每次调用发生的时刻」选峰/谷单价；一轮内跨时段也不会算错。
- **流式更新**：流式分片到达即更新；在 provider 上报 usage 之前，用字符数估算并明确标注 `≈`，结算后替换为真值。
- **余额**：`GET /user/balance` 取 CNY 钱包；刷新失败保留上次读数并标「已过期 + 最后更新时间」。
- **峰谷**：北京时间周一至周五 09:00–12:00、14:00–18:00 为高峰（不含法定节假日）；其余（含周末、法定节假日、调休上班的周末）为空闲，单价 50%。
- **提醒**：切换前 ≤5 分钟在读数带上显示倒计时；切换瞬间静默提示 3 秒，不弹窗、不打断输入。
- **配置**：余额刷新间隔（默认 60s，`15–3600`）走 DSH settings；View 布局走本插件设置页。

## 架构

```
definition/   契约与纯数据：ViewModel、RPC 协议、峰谷算法、价格表、节假日 policy
provider/     可替换实现：TablePricingStrategy、PolicyPeakPeriodProvider、
              DeepSeekBalanceProvider、BalanceState、Calibrator、NullAlertSink
consumer/     只依赖 definition：Ledger（token 折叠）、ViewModelBuilder、Hub、ViewConfig
host/         装配层：ctx 注册（事件/定时器/路由）全部走 ctx.effect
client/       core.js（Transport、Store、ViewRegistry、React 挂载壳、设置页）
client/views/ 每个 View 一个自包含文件
client/client.js  生成物：core.js + 全部 View 内联
```

依赖方向由 `scripts/check.mjs` 与 `tests/architecture.test.mjs` 强制：`definition` 不认识任何上层；`provider`/`consumer` 只依赖 `definition`；Host 不含任何槽位/渲染字段；Client 不 import Host 内部。

### 为什么 View 要在构建期内联

`__ModuleLoader__` 的 factory 是**经典脚本**，不能 `import` 兄弟文件；而「运行时再加载一个脚本」很脆：动态 `<script>` 受页面策略影响，页面全局钩子则受激活顺序影响（第二次激活会把第一次的钩子删掉，实测就是这样丢的）。所以：

- `src/client/core.js` 是可编辑的 bundle 源码（含标记 `/* __TOKEN_CONTROL_VIEWS__ */`）；
- `src/client/views/*.js` 每个 View 一个文件，`views/index.json` 是清单；
- `scripts/build-client.mjs` 把清单里的每个 View 内联进 `src/client/client.js`（提交进仓库），内联发生在 `apply` 内的一个同步块，用完立刻还原全局钩子；
- 运行时没有任何脚本注入、没有页面全局常驻、没有加载时序。

新增一个 View：新建 `views/<id>.js`（实现 `mount/unmount/update/getConfigSchema/supportedSlots`）+ `index.json` 加一行 + `pnpm build`。Host、ViewModel、其他 View 都不改。

## 安装

```sh
# 从 npm（发布后）
dsh plugin --profile <profile> add dsh-token-control

# 从 GitHub
dsh plugin --profile <profile> add github:RitvaManner/dsh-token-control

# 本地目录（开发）
dsh plugin --profile <profile> add .
```

安装后到 **设置 → Token 监控** 选择视图挂载位置（默认 `conversation.input.dock`，即输入框上方）。

## 开发（隔离环境）

```sh
node scripts/build-client.mjs     # 改过 core.js 或任何 View 后，重新生成 client.js
pnpm dev            # 先构建，再建立 .dsh-dev/ 隔离 DSH_HOME，link 本包，启动 dev profile
pnpm dev:reset      # 删掉 .dsh-dev/ 重建
node scripts/dev.mjs --no-start   # 只 link 不启动
```

- 全部状态在仓库内 `.dsh-dev/`，不读写 `~/.dsh`。
- 需要 `dsh` 在 `PATH`，或用 `DSH_CLI=<path-to-dsh>` 指定。
- `pnpm check` 会校验 `client.js` 是否落后于源文件（`build-client.mjs --check`）。
- 热重载验证步骤见 `docs/verify-v1.md`。

## 配置

| 位置 | 内容 |
|---|---|
| DSH settings（插件 Config，namespace `dsh-token-control`） | `balanceRefreshSeconds`（默认 60）、`balanceRefreshOnTurnEnd`（默认 true） |
| 设置 → Token 监控 | 启用哪些 View、各自挂哪个槽位、每个 View 自己的配置（由 `getConfigSchema()` 聚合） |
| `$DSH_HOME/dsh-token-control/views.json` | 上述 View 布局的持久化文件（Host 原子写入） |

## 价格与节假日来源

- 价格：[DeepSeek 模型 & 价格（人民币）](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/) — 表版本 `DS_CNY_2026_11`，单位「元 / 百万 tokens」。
  - `deepseek-flash`：命中 0.02 / 0.04，未命中 1 / 2，输出 4 / 8（空闲 / 高峰）
  - `deepseek-v4-pro`：命中 0.15 / 0.30，未命中 4.5 / 9，输出 13.5 / 27
- 峰谷规则与法定节假日：[国务院办公厅关于2026年部分节假日安排的通知](https://www.gov.cn/zhengce/content/202511/content_7047090.htm)（国办发明电〔2025〕7号）。
- 未覆盖年份标 `按工作日估算`（周一至周五 + 两个高峰窗口，无节假日）。

## 安全

- API Key **只在 Host** 通过 `ctx.credentials.resolve('DEEPSEEK_API_KEY')` 读取（provider 存储 → 环境变量 → `.env`），只出现在发往 DeepSeek 的 `Authorization` 头里。
- 返回浏览器的 ViewModel **逐字段构造**，有字段白名单与测试断言；不含 key、URL、上游响应体、Session 对象或事件。
- 错误码是枚举（`no-credential` / `http-401` / `network` / `bad-payload` …），上游文本被丢弃。
- View 脚本路由只按清单白名单、只读包内 `src/client/views/`，防路径穿越。
- **已知边界**：路由只绑定回环地址，但注册在 DSH `/api` 连接鉴权之外，同机进程可直接读快照（含余额，绝不含 key）。这与现有社区插件做法一致；要更严可把 handler 包进 `ctx.connection.admit`（需浏览器携带 DSH cookie，属于后续硬化项）。

## 已知取舍

1. **流式 token 只能是估算 + 尾部分片**：DeepSeek 的 usage 在流末尾才给，所以「流式中精确 token」不存在；本插件明确标注估算。
2. **余额与模型消费不同源**：`/user/balance` 含赠金与 Search/Fetch 扣费；差值校准做了平滑（α=0.3）与夹紧（0.5–2.0），仍可能有残差。
3. **只有 API Key 一条余额来源**：当前 profile 用 `deepseek-account` 登录且没有 API Key 时，余额显示「未配置」，不伪造数字。接口已为后续 `deepseekAccount` 实现预留。
4. **DSH Config schema 可降级**：`@deepseek-ai/schemastery` 通过动态 import 获取；取不到时插件照常运行，`apply(ctx, rawConfig)` 自行校验，设置页仍可改 View 配置。

## 检查与测试

```sh
node scripts/check.mjs   # 语法 + 架构方向 + 协议镜像 + View 清单
node --test tests/       # 单元测试
```

测试覆盖：峰谷边界（周末/节假日/调休/周五至周一跨段/未覆盖年份）、价格表（峰谷半价、命中未命中、别名、未知模型）、token 语义（`inputTokens` 是未命中部分）、ViewModel 字段白名单与旧字段兼容、余额失败保留旧值与过期标记、架构方向与协议镜像。

## License

MIT
