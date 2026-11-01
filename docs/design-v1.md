# dsh-token-control — 包结构与接口设计 v1（确认门 1）

> 状态：**已确认并实现**。确认结果与实现修订见 §13；门 3 实测结果见 `docs/verify-v1.md`。
> 目标：每轮 token 消耗（输入/输出/缓存命中/未命中分开）+ 金额 + DeepSeek 人民币余额 + 峰谷时段与切换提醒，Host/Client 强制分离，UI 完全可插拔。

---

## 0. 先说环境事实（影响工程方案，需你拍板）

| 事实 | 核实方式 | 影响 |
|---|---|---|
| 本机没有 `git` | `git --version` → 命令不存在 | 无法 `git clone` 模板 |
| GitHub / npm registry 不可达 | `raw.githubusercontent.com`、`registry.npmjs.org` 连接被关闭 | 无法拉模板、无法 `pnpm install` 新依赖 |
| DSH 自带插件模板可读 | `app.asar/.../skills/cordis-plugin-development/templates/` | 可作为包结构的等价基线 |
| 已安装的社区插件可读 | `dsh-session-recycle-bin`、`dshmarket`（profile `node_modules`） | 可作为 Host+Client 双半、路由、slots 的真实范例 |
| DSH 版本面 | `@deepseek-ai/*` 由 DSH 安装目录解析（`dshmarket` 直接 `import '@deepseek-ai/schemastery'` 且 profile 里没有该包） | 插件可以零依赖引用 DSH 随包，无需联网装依赖 |

**结论**：`pnpm dev` 的「零依赖 + 纯 ESM JS」是当前唯一能离线跑通的形态。
下文 §10 给出三个可选工程方案，需要你选一个。

---

## 1. 已核实的 DSH API（设计依据，非假设）

| 需求 | 真实机制 | 证据 |
|---|---|---|
| 每轮 token | Session 持久日志事件 `assistant/message` 携带 `usage?: TokenUsage`；`turn/start` / `turn/end` 界定轮次 | `SessionEventMap`（inspect `Service tokenMeter` / `sessionProjections`） |
| token 字段语义 | `inputTokens` **已是未命中部分**：源码 `input = max(0, prompt_tokens - cacheRead - cacheWrite)` | asar `2320087-2320100`；`token-meter` 的 `uncachedInputTokens` 亦印证 |
| 缓存命中 | `cacheReadTokens` ← `prompt_cache_hit_tokens`，DeepSeek 无 cache-write | 同上 |
| 流式实时 | `agent/assistant-stream` 的 `frame.chunk.type === 'usage'`，另有 `text-delta`/`reasoning-delta` | inspect `Event agent/assistant-stream` |
| 读日志（回填） | `ctx.sessions.get(sessionId)` → 内存 `Session`，`snapshotEvents()`；冷会话用 `ctx.sessionQuery.readSession(id)` | inspect `Service sessions` / `sessionQuery` |
| 配置（DSH settings） | Host 插件 `export const Config = z.object({...})`，`z` 来自 `@deepseek-ai/schemastery`（DSH 随包）；settings namespace = loader entry id | `dshmarket/lib/settings.js:70`；asar `1644016`「The settings namespace is the Cordis entry id」 |
| 余额（人民币） | `GET https://api.deepseek.com/user/balance` → `balance_infos[{currency:'CNY',total_balance,granted_balance,topped_up_balance}]` | 官方 API 文档；另可选 `ctx.deepseekAccount.getBalance()`（平台钱包，CNY） |
| 密钥 | `ctx.credentials.resolve('DEEPSEEK_API_KEY')`（provider store → 环境变量 → `.env`），只在 Host | inspect `Service credentials` |
| Host→Client 通道 | 社区插件的既有事实标准：`ctx.webServer.register({kind:'prefix', path, handler})` + 浏览器 `fetch`/SSE | `dsh-session-recycle-bin`（`/api/session-trash`） |
| 槽位 | `conversation.composer.dock`（输入框卡片下方的环境读数带，session 作用域，list 类型，props 含 `sessionId`）；设置页用 `settings.section` | inspect `Slots.listSubTree` |
| 内置占用 | `composer.dock` 已被 `ui-chat` 的 `usage`（order 1）占用 → 我们用新 id + order 2，**不覆盖别人** | inspect `Slots` occupants |
| 定时器 | `ctx.timer.interval/timeout`，注册必须包在 `ctx.effect()` | inspect `Service timer` |

> 关于 `host.call()`：客户端 Builtin 里确实有 `host.call(method,args)`（「Package-private JSON RPC」），但它是 **动态 Cordis 包（cordis_define 运行时）** 的符号面，静态 bundle 的 `__ModuleLoader__` factory 拿不到它。因此本插件使用「同源 HTTP RPC + SSE」作为 Host↔Client 通道（与已装插件同款），不是凭空发明。

---

## 2. 包结构

```
dsh-token-control/                      # 仓库根 = 包根（单包，无 monorepo）
├─ package.json                         # name/dsh.bundle/dsh.client/exports/files/scripts
├─ cordis.patch.yml                     # 插入一行 Host 插件
├─ dsh.plugin.json                      # 发布社区用的注册清单（v1 先写，暂不发布）
├─ icon.svg                             # 原创图标（面板/插件列表）
├─ locale/{en,zh}.json                  # meta.title / meta.description / UI 文案
├─ LICENSE  README.md  README.zh.md
├─ jsconfig.json                        # checkJs 类型校验（JSDoc 接口即契约）
├─ .npmignore / files 白名单
│
├─ docs/
│  ├─ design-v1.md                      # 本文件
│  └─ verify-v1.md                      # 交付门 3 的实测记录
│
├─ scripts/
│  ├─ dev.mjs                           # 建/复用 .dsh-dev 隔离 profile，link 本包，起进程
│  └─ check.mjs                         # 架构边界检查（见 §9）
│
├─ tests/                               # node --test，无外部测试框架
│  ├─ policy.test.mjs                   # 峰谷边界/节假日/调休/跨年
│  ├─ pricing.test.mjs                  # 价格表 + 峰谷选择 + 未知模型
│  ├─ tokens.test.mjs                   # input=未命中 的语义回归
│  ├─ view-model.test.mjs               # 逐字段白名单、旧字段兼容
│  ├─ config.test.mjs                   # 配置合并/校验
│  └─ architecture.test.mjs             # import 方向断言（Definition 不许 import 其他段）
│
└─ src/
   ├─ definition/                       # ★ 只放契约与纯数据/纯函数：不 import node:*、不碰 DOM、不认识 ctx
   │  ├─ view-model.js                  # ViewModel v1 形状 + 构造函数 + 兼容合并规则
   │  ├─ seam.js                        # 三个可替换接口 + View + AlertSink 的 JSDoc typedef 与运行时守卫
   │  ├─ tokens.js                      # TokenBuckets 归一化（input=未命中 → 命中/未命中/输入合计）
   │  ├─ money.js                       # 分为单位的整数运算、CNY 格式化、比例夹紧
   │  ├─ pricing-table-2026-11.js       # 官方人民币价目表（表版本常量）
   │  ├─ peak.js                        # 峰谷纯算法：getCurrentPeriod / getNextTransition / getRemainingSeconds
   │  ├─ policy/
   │  │  ├─ index.js                    # 年份注册表 + 未覆盖年份的「按工作日估算」回退
   │  │  └─ policy-2026.js              # ★ 独立 policy 文件：2026 法定节假日 + 调休上班日
   │  └─ protocol.js                    # RPC 路径/帧类型/字段白名单/错误码枚举
   │
   ├─ provider/                         # ★ 三个可替换实现，只 import definition
   │  ├─ pricing-table.js               # TablePricingStrategy（结算时按调用时刻问 PeakPeriodProvider）
   │  ├─ peak-policy.js                 # PolicyPeakPeriodProvider
   │  ├─ balance-deepseek.js            # DeepSeekBalanceProvider（Host 侧解析 key，调 /user/balance）
   │  ├─ balance-state.js               # 余额快照：成功/失败保留旧值 + 过期秒数
   │  ├─ calibrator.js                  # 余额差值校准（指数平滑比例）
   │  └─ alerts-null.js                 # NullAlertSink（接口保留，v1 不启用）
   │
   ├─ consumer/                         # ★ 只 import definition；provider 实例由 host 注入
   │  ├─ ledger.js                      # 每会话每轮 token 折叠（事件驱动 + 流式覆盖 + 回填）
   │  ├─ view-model-builder.js          # 纯函数：把 ledger/balance/period 拼成 ViewModel（逐字段）
   │  ├─ hub.js                         # 订阅者表 + 修订号 + 增量广播（与传输无关）
   │  └─ view-config.js                 # View 布局配置：默认值、校验、合并（不认识任何具体 View）
   │
   ├─ host/                             # ★ 装配层：唯一允许 import provider/consumer 与 ctx 的地方
   │  ├─ index.js                       # bundle 入口：inject / Config / apply（所有注册包 ctx.effect）
   │  ├─ routes.js                      # webServer：snapshot / stream / view-config / balance-refresh
   │  └─ paths.js                       # 数据目录解析（$DSH_HOME）与原子写
   │
   └─ client/                           # ★ 浏览器侧，只 import definition 的 ViewModel/协议常量
      ├─ client.js                      # __ModuleLoader__ 注册；slots.inject + settings.section
      ├─ transport.js                   # 快照拉取 + SSE 订阅 + 重连退避（fetch/ReadableStream）
      ├─ store.js                       # ViewModelStore：快照 + 增量合并（认识旧字段、忽略新字段）
      ├─ registry.js                    # ViewRegistry：注册/启用/槽位分配/配置聚合
      ├─ mount.js                       # React 壳：把 DOM 容器交给 View，桥接 store→view.update
      ├─ schema-form.js                 # getConfigSchema() → 表单（自绘控件，只用 --dsw-alias-* token）
      ├─ settings-page.js               # settings.section 页面：聚合所有 View 的 schema
      └─ views/
         ├─ index.js                    # View 清单（新增 View 只改这里）
         └─ readout-bar.js              # 第一版 View：输入框下方读数带
```

**新增一个 View 的改动面**：`src/client/views/<new>.js` + `views/index.js` 一行注册。Host、ViewModel、其他 View、其他任何文件都不动。

---

## 3. Seam 三段式：依赖方向（硬约束）

```
            ┌──────────────────────────────┐
            │ definition（契约/纯数据/纯算法）│
            └──────────▲───────────▲───────┘
                       │           │
              ┌────────┴───┐   ┌───┴────────┐
              │ provider   │   │ consumer   │
              │（可替换实现）│   │（只产出VM） │
              └────────▲───┘   └───▲────────┘
                       │           │
                  ┌────┴───────────┴────┐
                  │ host（装配 + ctx）    │
                  └──────────▲──────────┘
                             │ 同源 RPC/SSE（仅 ViewModel）
                  ┌──────────┴──────────┐
                  │ client（View 插件机） │
                  └─────────────────────┘
```

规则（由 `tests/architecture.test.mjs` 逐文件扫描 import 强制执行）：

1. `definition/**` 不得 import `provider|consumer|host|client`，不得 import `node:*`、不得出现 `document|window|ctx.`。
2. `provider/**` 只能 import `definition`。**不得** import consumer/host。
3. `consumer/**` 只能 import `definition`；它拿到的是 provider 实例（由 host 构造并注入），只按 definition 的接口类型使用。
4. `host/**` 可以 import 三者；`client/**` 只能 import `definition`（+ 浏览器全局）。
5. Host 源码中不得出现 `slots`、`register(`（槽位）、`className`、`<div`、`render` 等渲染词；Client 源码中不得出现 `ctx.get(` 后的 Host 服务名、不得 import provider/consumer。
6. `src/host` 与 `src/client` 是两个独立入口（`exports['.']` / `exports['./client']`），Host 包绝不 import client 文件。

---

## 4. 接口定义（`src/definition/seam.js`）

### 4.1 PeakPeriodProvider（只报时段，不参与算钱）

```ts
/** @typedef {'peak'|'idle'} PeriodKind */
/** @typedef {{kind:PeriodKind, label:string, ratioOfPeak:number, calendarYear:number, estimated:boolean}} PeriodInfo */
/** @typedef {{atMs:number, to:PeriodKind}} PeriodTransition */

interface PeakPeriodProvider {
  /** @param atMs 毫秒时间戳（UTC ms） */
  getCurrentPeriod(atMs: number): PeriodInfo;
  /** 严格晚于 atMs 的下一次切换；覆盖年份内必定存在 */
  getNextTransition(atMs: number): PeriodTransition;
  /** 距下一次切换的整秒数（≥0） */
  getRemainingSeconds(atMs: number): number;
}
```

- 只看时间，不返回任何价格。「未覆盖年份」→ `estimated:true`，规则退化为「周一至周五 09–12 / 14–18 为高峰，无节假日」，View 上标注「按工作日估算」。
- 纯函数、无状态、无 IO；同一 `atMs` 必得同一结果。

### 4.2 PricingStrategy（可替换）

```ts
/** @typedef {{missTokens:number, hitTokens:number, writeTokens:number, outputTokens:number, reasoningTokens:number}} TokenBuckets */
/** @typedef {{missCNY:number, hitCNY:number, outputCNY:number, totalCNY:number, unitPrices:UnitPrices|null, model:string, pricedAtMs:number, period:PeriodKind, unknownModel:boolean}} PriceBreakdown */

interface PricingStrategy {
  /**
   * 结算「一次 assistant 调用」的金额。
   * 内部在结算时用 call.atMs 问 PeakPeriodProvider 选峰/谷单价 —— 与轮次何时结束无关。
   */
  price(buckets: TokenBuckets, call: {model:string, provider:string, atMs:number}): PriceBreakdown;
  /** 供 ViewModel 元数据用（表版本、币种、支持的模型），不含任何密钥 */
  describe(): {tableVersion:string, currency:'CNY', models:string[]};
}
```

- 金额全程用「分」的整数/定点运算，避免浮点漂移；对外暴露 `number` 元，保留 6 位小数。
- 未知模型：`unknownModel:true`、`totalCNY` 用 flash 价但 **不** 静默 —— ViewModel 里带标记，View 显示 `≈`。

### 4.3 BalanceProvider（可替换，Host only）

```ts
/** @typedef {{amountCNY:number, currency:'CNY', atMs:number, source:string}} BalanceReading */

interface BalanceProvider {
  readonly id: string;                 // 'deepseek'
  readonly label: string;              // 'DeepSeek 余额'
  /** 失败必须 throw（由 BalanceState 保留旧值），成功返回一次读数 */
  fetch(signal: AbortSignal): Promise<BalanceReading>;
}
```

- 密钥解析、HTTP、错误码映射全在实现内部；**接口层面没有任何密钥字段**。
- 第一版实现 `DeepSeekBalanceProvider`：`ctx.credentials.resolve('DEEPSEEK_API_KEY')` → `GET /user/balance` → 取 `currency==='CNY'` 的 `total_balance`。
- 预留 `deepseek-account` 实现（平台钱包）留到后续 —— 接口不变。

### 4.4 View（Client 侧，可替换、可多个）

```ts
interface View {
  readonly id: string;                 // 'readout-bar'
  readonly label: string;              // 设置页显示名
  /** 挂载：容器由注册表创建并托管；View 自己渲染、自己订阅 ViewModel */
  mount(container: HTMLElement, ctx: ViewContext): void;
  unmount(): void;
  /** 增量推送；实现必须容忍任何缺失/未知字段（旧 View 不认识新字段 → 忽略，不报错） */
  update(viewModel: ViewModel): void;
  /** 声明自己的配置项（JSON Schema 子集），设置页自动聚合 */
  getConfigSchema(): ViewConfigSchema;
  /** 声明可挂的槽位；新增槽位不需要改已有 View */
  supportedSlots(): string[];
}

/** @typedef {{
 *   getSnapshot(): ViewModel,
 *   subscribe(fn:(vm:ViewModel)=>void): ()=>void,
 *   getConfig(): Record<string, unknown>,
 *   patchConfig(patch: Record<string, unknown>): void,
 *   locale: (key:string, fallback:string)=>string,
 * }} ViewContext */
```

约定：`mount` 只在容器内构建 DOM，不写 `document.body`、不读别的 View 的 DOM；`unmount` 必须停掉自己所有 timer/listener。

### 4.5 AlertSink（接口保留，v1 不启用）

```ts
interface AlertSink {
  onPeakTransition(e:{from:PeriodKind,to:PeriodKind,atMs:number}): void;
  onBalanceStale(e:{staleSeconds:number, updatedAt:number|null}): void;
  onBudgetThreshold(e:{turnCNY:number, sessionCNY:number}): void;
}
```

v1 装配 `NullAlertSink`（全部空实现）。未来新增告警 = 新 `provider/alerts-*.js` + host 换一行注入；或做成一个独立 View，Host/ViewModel 都不改。

---

## 5. ViewModel v1（Host 唯一产出，UI 无关）

```jsonc
{
  "schemaVersion": 1,
  "sessionId": "…",
  "turn": {
    "index": 7,
    "state": "idle|streaming|settled|error",
    "live": false,
    "tokens": {
      "input": 12345,        // = cacheMiss + cacheHit + cacheWrite（输入合计）
      "output": 678,
      "cacheHit": 11200,
      "cacheMiss": 1145,
      "cacheWrite": 0,
      "reasoning": 300,
      "total": 13023,
      "estimated": false      // 流式估算期间为 true
    },
    "cost": {
      "cny": 0.0123,
      "settled": true,
      "basis": "table|table+calibrated|unknown-model",
      "breakdown": { "missCNY":0, "hitCNY":0, "outputCNY":0 }
    },
    "models": ["deepseek-flash"]
  },
  "session": { "tokens": {…}, "costCNY": 0.45 },
  "balance": {
    "state": "ok|stale|unconfigured|error",
    "cny": 98.76,
    "updatedAt": 1761999999000,
    "staleSeconds": 0,
    "source": "deepseek-api",
    "error": { "code": "no-credential|http-401|network|bad-payload" }
  },
  "period": {
    "kind": "peak|idle",
    "label": "高峰|空闲",
    "ratioOfPeak": 1|0.5,
    "calendarYear": 2026,
    "estimated": false,
    "nextTransitionAt": 1762003200000,
    "remainingSeconds": 742,
    "remind": true,            // ≤5 分钟
    "upcoming": "idle"         // 下一次是峰还是谷
  },
  "meta": { "hostTime": 1761999999000, "revision": 812, "currency": "CNY" }
}
```

**兼容契约（写进 `view-model.js` 的注释与测试）**

- 字段只增不改、不删不改义；新增字段必须可选。
- 任何 View 只读它认识的字段；缺失即视为「不展示」，**禁止 throw / 禁止默认崩**。
- `schemaVersion` 只在破坏性变更时 +1；v1 内只做加字段。
- Host 侧构造走 `toWire()` 白名单（逐字段赋值，绝不 `JSON.stringify(session)`）。

---

## 6. Host 数据流

### 6.1 组装（`src/host/index.js`）

```
inject = ['sessions','webServer','credentials','timer']   // 缺省时用 ctx.get 并降级
apply(ctx, config):
  const peak      = createPolicyPeakPeriodProvider(POLICY_REGISTRY)
  const pricing   = createTablePricingStrategy(PRICE_TABLE, peak)      // 注入 peak 接口
  const balance   = createDeepSeekBalanceProvider(ctx.credentials, config)
  const alerts    = createNullAlertSink()
  const ledger    = createLedger({ ctx.sessions, now })
  const balanceSt = createBalanceState({ provider: balance, scheduler: ctx, config })
  const hub       = createHub()                                       // 订阅者/修订号
  const builder   = createViewModelBuilder({ ledger, pricing, peak, balanceSt, calibrator })
  ctx.effect(() => ledger.attach(ctx), 'token-control: session events')   // 内部 ctx.on X3
  ctx.effect(() => routes.register(ctx, {hub, ledger, builder, viewConfig, balanceSt}), 'token-control: routes')
  ctx.effect(() => balanceSt.start(), 'token-control: balance poller')     // ctx.timer.interval
```

### 6.2 事件订阅（全部 `ctx.effect` 包裹）

| 事件 | 处理 |
|---|---|
| `session/event`（`turn/start`） | 新轮开始：ledger 开新 bucket，清 live 覆盖 |
| `session/event`（`assistant/message`） | 把 `usage` 归一到 TokenBuckets 累加进本轮；记录 model/atMs 供定价；标记该 step 已结算 |
| `session/event`（`turn/end`） | 本轮结算：算金额（逐 step 按各自调用时刻定价）、写入 `turn.cost`、置 `settled`、按配置触发余额刷新 |
| `agent/assistant-stream`（`start/chunk/end`） | `usage` 分片 → live token；`text/reasoning-delta` → 字符计数用于估算；`end` 清 live 覆盖 |
| `session/disposed` | 释放该会话缓存（保留最近 N 个，防抖动） |

### 6.3 回填（页面刷新 / 进程重启后仍正确）

- 首次收到某 `sessionId` 的 `snapshot` 请求时：`ctx.sessions.get(id)` 命中 → `session.snapshotEvents()` 折叠；否则 `ctx.sessionQuery.readSession(id)`。
- 折叠只读 `turn/*`、`assistant/message`，与实时路径共用同一个 fold 函数（测试保证一致）。

### 6.4 余额

- 触发点：①每轮 `turn/end`（可配开关，默认开）；②低频轮询 `ctx.timer.interval(config.balanceRefreshSeconds*1000)`，默认 60s，最小 15s。
- 失败：保留上次读数，`state='stale'`，`updatedAt` 不变，`staleSeconds = hostTime - updatedAt`，`error.code` 为枚举（不含 URL/响应体/密钥）。
- 并发去重：同一时刻只有一个 in-flight（`AbortController` + 合并请求）。
- 启动即刷一次（成功前 `state='unconfigured'` 或 `stale`）。

### 6.5 金额校准（价格表为主 + 余额差值）

- 每轮结算记录 `{computedCost, balanceBefore, balanceAfter, atMs}`；仅当两端余额都新鲜、且 `balanceAfter > 0` 才参与。
- `ratio = actualDelta / computedCost`，指数平滑 α=0.3，夹在 `[0.5, 2.0]`；`cost.basis` 标 `table+calibrated`。
- 只校准**下一轮及以后**的展示值，不用它改写当轮余额；Search/Fetch、赠金优先扣减等噪声靠平滑吸收。
- 校准器状态在内存（进程生命周期）；不落盘，避免历史脏数据。

### 6.6 峰谷与倒计时

- Host 在每次广播时计算 `period`，并在跨越切换点时立即广播一次。
- **倒计时不靠 Host 逐秒推送**：Host 给 `nextTransitionAt/remainingSeconds`，View 用本地 1s interval 递减（`remainingSeconds` 只是不支持本地计时的兜底）。
- `remind = remainingSeconds <= 300`；`upcoming` 给出「即将进入空闲/高峰」。切换瞬间通过 SSE 推一帧，View 显示 3s 的静默提示（不弹窗、不打断输入；「不确定就不做」的静默原则）。

### 6.7 传输（`src/host/routes.js`）

| 方法/路径 | 说明 |
|---|---|
| `GET /api/dsh-token-control/v1/snapshot?sessionId=` | `{schemaVersion, revision, viewModel}` |
| `GET /api/dsh-token-control/v1/stream?sessionId=&since=` | `text/event-stream`；`event: frame`，`data: {revision, patch}`；`since` 落后太多则先发 `event: reset` 全量快照；15s 心跳 |
| `GET /api/dsh-token-control/v1/view-config` | `{schemaVersion, views:[{id, enabled, slot, config}]}` |
| `PUT /api/dsh-token-control/v1/view-config` | 校验（未知字段丢弃、未知 View 忽略并回报 warning）后原子落盘 |
| `POST /api/dsh-token-control/v1/balance/refresh` | 触发一次刷新（设置页用） |

- 前缀路由 `kind:'prefix'`，所有 handler 都在 `ctx.effect(() => ctx.webServer.register(...))` 内。
- 所有响应逐字段构造 + 字段白名单；`Cache-Control: no-store`；错误统一 `{code, message}` 且 message 不含密钥/URL。
- Host 不关心谁在消费，也不产出任何渲染字段。

---

## 7. Client 架构

### 7.1 启动（`client.js`）

```
window.__ModuleLoader__.load({ id: 'dsh-token-control', factory(require) {
  const React = require('react')
  return {
    inject: ['slots','locale'],
    apply(ctx) {
      // 1. ViewRegistry：注册内置 View（来自 views/index.js）
      // 2. 拉 view-config → 解析出 [{view, slot}]（多个 View 可同时启用）
      // 3. 对每个分配：ctx.slots.inject(slot, () => ctx.slots.register({name:slot, id:`token-control:${view.id}`, order}, SlotHost))
      // 4. 注册 settings.section 页面「Token 监控」→ 聚合所有 View 的 getConfigSchema()
      // 以上全部包 ctx.effect()
    }
  }
}})
```

### 7.2 ViewModelStore（`store.js`）

- 持有 `viewModel`；`apply(patch)` 浅合并已知对象、忽略未知键；`applyReset(vm)` 全量替换并**保留** View 未认识的新字段（原样留在对象里，View 只是不读）。
- `subscribe(fn)`，变更后同步通知（Views 自己决定节流）。

### 7.3 挂载桥（`mount.js`，唯一的 React 代码）

```
function SlotHost({ sessionId, slot, viewId }) {
  // transport.start(sessionId) → store；useSyncExternalStore 订阅
  const ref = useRef(null)
  useEffect(() => {
    const container = document.createElement('div')
    ref.current.appendChild(container)
    const handle = registry.create(viewId, container, { getSnapshot, subscribe, getConfig, patchConfig, locale })
    return () => handle.dispose()          // view.unmount() + 移除 DOM
  }, [viewId, slot])
  useEffect(() => view?.update(store.get()), [vm])
  return <div ref={ref} className="dsh-token-control-cell" />
}
```

- 多个 View 同时启用：每个 View 一个 `SlotHost`，各自 `transport` 引用同一个 Store（按 sessionId 共享连接），互不感知。
- View 崩溃隔离：`mount/update` 用 try/catch 包裹并 `console.error`，只摘掉该 View，不影响槽位其他条目。

### 7.4 设置聚合（`settings-page.js`）

- 遍历 `ViewRegistry.list()` → 每个 View 一段：启用开关、槽位下拉（`supportedSlots()` 与已声明槽位的交集）、`getConfigSchema()` 生成的字段。
- 新增 View 不改这个文件（纯 registry 驱动）。
- 保存 → `PUT /view-config` → 重新解析分配 → 只重挂受影响的 View。

### 7.5 ReadoutBar（第一版 View）

- 两行紧凑文本（单行放得下就单行）：
  - 第 1 行：`本轮 13,023 tok · ¥0.0123 · 入 12,345 / 出 678 · 命中 11,200 / 未命中 1,145`
  - 第 2 行：`余额 ¥98.76 · 2 分钟前 · 高峰 · 距空闲 12:22`（过期时 `余额 ¥98.76（已过期 8 分钟）`）
- 流式中：末尾加 `· 输出中 ≈ 312`（估算标记），结算后去掉 `≈`。
- 切换前 ≤5 分钟：第 2 行尾部 `· 12:22 后进入空闲`，切换瞬间闪一次 `已进入空闲` 3s。
- 配置项：`compact`（单行/两行）、`showBalance`、`showCacheSplit`、`showCountdown`、`precision`（金额小数位）、`order`（槽位内位置）。
- 样式只用 `--dsw-alias-*` token；不 import 任何 DSH Client 包。

---

## 8. 配置

### 8.1 DSH settings（Host Config，namespace = `dsh-token-control`）

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `balanceRefreshSeconds` | int ≥15 | `60` | **第一版唯一暴露的调优项**，就是需求里的「余额刷新间隔」 |
| `balanceRefreshOnTurnEnd` | boolean | `true` | 每轮结束刷新 |

- 其余（价格表、峰谷 policy、API key 引用名 `DEEPSEEK_API_KEY`）都写死在代码/policy 文件里，不进 UI。
- 设置页里由 DSH 自动生成表单（`settings.describe()` 把 Config 投影成 form）。

### 8.2 View 布局配置（`<DSH_HOME>/dsh-token-control/views.json`）

```jsonc
{
  "schemaVersion": 1,
  "views": [
    { "id": "readout-bar", "enabled": true, "slot": "conversation.composer.dock",
      "config": { "compact": false, "showBalance": true, "showCacheSplit": true, "showCountdown": true } }
  ]
}
```

- 为什么不用 Host Config：View 的 schema 来自浏览器端 `getConfigSchema()`，Host 无法在编译期知道，塞进 Config 只能变成一坨 JSON 字符串，DSH 自动表单也表达不了。落盘仍由 Host 完成（Client 不直接碰文件系统）。
- 未知 View / 未知字段：保留原样、丢弃非法值、回报 warnings，不报错。

---

## 9. 峰谷 policy 与价格表（真实数据）

### 9.1 `src/definition/policy/policy-2026.js`

来源：[国务院办公厅关于2026年部分节假日安排的通知（国办发明电〔2025〕7号）](https://www.gov.cn/zhengce/content/202511/content_7047090.htm)。

```js
export default {
  year: 2026,
  timeZone: 'Asia/Shanghai',           // 固定 UTC+8，无夏令时
  source: 'https://www.gov.cn/zhengce/content/202511/content_7047090.htm',
  publishedAt: '2025-11-04',
  peakWindows: [['09:00','12:00'], ['14:00','18:00']],   // 仅周一至周五
  offPeakRatioOfPeak: 0.5,
  holidays: [
    { name: '元旦',   from: '2026-01-01', to: '2026-01-03' },
    { name: '春节',   from: '2026-02-15', to: '2026-02-23' },
    { name: '清明节', from: '2026-04-04', to: '2026-04-06' },
    { name: '劳动节', from: '2026-05-01', to: '2026-05-05' },
    { name: '端午节', from: '2026-06-19', to: '2026-06-21' },
    { name: '中秋节', from: '2026-09-25', to: '2026-09-27' },
    { name: '国庆节', from: '2026-10-01', to: '2026-10-07' },
  ],
  // 调休上班的周末（按规则仍算空闲；记录在案用于展示与未来策略）
  makeUpWorkdays: ['2026-01-04','2026-02-14','2026-02-28','2026-05-09','2026-09-20','2026-10-10'],
};
```

判定顺序：`周六/周日 → idle`；`命中 holidays → idle`；`周一至周五且在 peakWindows → peak`；其余 → `idle`。
未覆盖年份：`estimated:true`，仅按周一至周五 + 两个窗口判断，无节假日；UI 显示「按工作日估算」。

### 9.2 `src/definition/pricing-table-2026-11.js`

来源：[DeepSeek 模型 & 价格（人民币）](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)，表版本 `DS_CNY_2026_11`。单位：元 / 百万 tokens。

| 模型 | 缓存命中（空闲/高峰） | 缓存未命中（空闲/高峰） | 输出（空闲/高峰） |
|---|---|---|---|
| `deepseek-flash` | 0.02 / 0.04 | 1 / 2 | 4 / 8 |
| `deepseek-v4-pro` | 0.15 / 0.30 | 4.5 / 9 | 13.5 / 27 |

- 空闲价 = 高峰价 × 0.5（与官方一致）。
- 未列出的模型名（含旧的 `deepseek-chat`/`deepseek-reasoner` 别名）→ 落到 `deepseek-flash` 价并标 `unknown-model`，不静默假装精确。
- 价格表是纯数据 + 版本常量，替换价格 = 新增一个表文件并切换注册，不动算法。

---

## 10. 工程与验证

### 10.1 需要你选一个（这是本门的核心问题）

**方案 A（推荐，可离线跑）**：纯 ESM JavaScript（无构建），`jsconfig` + JSDoc 保证接口契约，`node --test` 单测，`files` 白名单。不依赖 npm install，DSH 随包依赖（`@deepseek-ai/schemastery`）由 DSH 解析。
**方案 B**：TypeScript + esbuild（更接近社区模板），但 `pnpm install` 在本机不可达 registry；除非你有离线 store 或镜像。
**方案 C**：你先提供 `exoticknight/dsh-plugin-template` 的本地副本/压缩包，我按它的真实结构与脚本落地（最贴合你的原始要求）。

### 10.2 `.dsh-dev` 隔离启动（`scripts/dev.mjs`）

```
DSH_HOME = <repo>/.dsh-dev            # 全部落在工作区内，不碰 ~/.dsh
dsh --profile dev --from-default-profile web   # 首次用官方 web 模板铺 profile
dsh plugin --profile dev add <repo>            # 本地 link 本包
dsh --profile dev                              # 独立端口启动，与现运行的 GUI 互不影响
```

- 单例守护：重复执行不会产生第二份 profile；`--reset` 删除 `.dsh-dev` 重建。
- 不碰现有 Desktop profile（`D:\deepseek\.dsh\profiles\desktop`）。

### 10.3 热重载验证步骤（交付门 3 执行，实测后写进 `docs/verify-v1.md`）

1. Client 侧改动：改 `views/readout-bar.js` → 刷新页面（或 dev 工具的 hot mount）→ 读数带变化；日志无 `slot entry crashed`。
2. Host 侧改动：改 `provider/pricing-table.js` → 触发一次轮次结束 → 金额变化；若 DSH loader 未开 HMR，则用 `--patch` 触发配置重载或重启 dev 进程，并在报告里写清楚「观察到的是 HMR 还是重启」。
3. 卸载/禁用：`dsh plugin --profile dev remove dsh-token-control` → 槽位条目消失、路由 404、无残留 timer（用 `ctx.effect` 的 disposer 断点确认）。

### 10.4 安装验证（正式 profile，门 3 之后再动）

- `plugin_manager` `install_bundle` 安装到 **desktop** profile（需要你同意后我才动它；会同时影响所有会话）。
- 安装后按 inspection 确认：`application: applied`、slot 出现 `token-control:readout-bar`、locale/icon 正确、无 diagnostic。

### 10.5 测试清单（`node --test`）

- 峰谷：周五 11:59/12:00、周一 08:59/09:00、国庆整个区间、调休周六、2027 年（估算标记）、跨切换点 `getRemainingSeconds` 单调。
- 价格：同一 usage 在 peak 与 idle 下金额 = 2×；cacheHit 与 cacheMiss 分开计价；未知模型标记。
- token 语义：`input=1000, cacheRead=800` → 展示 命中 800 / 未命中 200 / 输入合计 1000（防止把 inputTokens 当总输入）。
- ViewModel：`toWire` 只输出白名单字段；给 View 喂一个多了未知字段的对象不报错。
- 架构：`definition` 不 import 其他段；`client` 不 import provider/consumer；`host` 不含渲染/槽位字段。

---

## 11. 已知取舍（写清楚，不藏）

1. **与内置读数带重复**：`composer.dock` 已有 `ui-chat` 的 `usage` cell。我们新增独立 id，默认排在它后面（order 2），两行并存；若你希望只留一个，可在 View 配置里提供「紧凑模式」，或后续把 ReadoutBar 改挂到 `conversation.input.dock`（输入框上方）—— 只需改配置，不改代码。
2. **流式 token 只能是估算 + 尾部分片**：DeepSeek 的 usage 在流末尾才给，所以「流式中精确 token」物理上不存在；方案是「分片到达即更新 + 活跃调用期间按字符估算并标 `≈`」，结算后用真值覆盖。
3. **余额与消费口径不完全同源**：`/user/balance` 是账户总额（含赠金，且 Search/Fetch 也扣），价格表只算模型 token。差值校准做了平滑与夹紧，但仍可能出现「本轮金额之和 ≠ 余额差」的残差，这是数据源本身的限制。
4. **API Key 依赖**：若这个 profile 只用 `deepseek-account` 登录、没有 `DEEPSEEK_API_KEY`，`/user/balance` 会 401 → 余额显示「未配置」而不是伪造数字。后续可加 `deepseekAccount` 实现（接口已留）。
5. **峰谷规则是「官方规则的本地副本」**：policy 文件按年更新，未覆盖年份明确降级为估算，不假装精确。

---

## 12. 确认门 1：需要你回答

1. **工程方案**：A（纯 JS 零构建，推荐）/ B（TS+esbuild，需解决离线依赖）/ C（你提供模板副本，我按它落地）？
2. **余额来源**：只用 `DEEPSEEK_API_KEY`（严格对应「API Key 只在 Host 端读取」）；还是允许「无 key 时回退 `ctx.deepseekAccount.getBalance()` 平台钱包」？
3. **密钥引用名**：固定 `DEEPSEEK_API_KEY` 可以吗？（DSH `ctx.credentials` 会先查 provider 存储再查环境变量/.env）
4. **读数带位置**：先按需求挂 `conversation.composer.dock`（输入框下方，与内置 usage 并存），还是直接挂 `conversation.input.dock`（输入框上方，独占一行）？

确认后我进入交付门 2：逐文件代码（先 Definition，再 Provider，再 Consumer，最后 Host/Client 装配）。

---

## 13. 确认结果（2026-11-01）与由此产生的实现修订

你的选择：

| 项 | 选择 |
|---|---|
| 工程方案 | **A：纯 ESM JS，零构建** |
| 余额来源 | **仅 API Key**（`/user/balance`） |
| 密钥引用 | 固定 **`DEEPSEEK_API_KEY`**，经 `ctx.credentials.resolve` |
| 读数带槽位 | **`conversation.input.dock`**（输入框上方独占一行，order 25；该槽位现有 todo=0 / goal=10 / queue=20） |

由此确定的三处实现修订：

**修订 1 — 客户端 View 的“独立文件 + 零构建”**
`__ModuleLoader__` 的 factory 是经典脚本，不能 `import`；一个包只能有一个 client bundle。为同时满足「零构建」与「新增 View = 新文件 + 注册」，采用：
- `src/client/client.js`：唯一的 bundle，含传输/Store/Registry/React 壳/设置页/本地化；
- `src/client/views/*.js`：每个 View 一个**自注册经典脚本**，通过 `window.__DSH_TOKEN_CONTROL_VIEWS__.register(...)` 挂到 Registry；
- `src/client/views/index.json`：View 脚本清单（新 View = 新文件 + 清单一行）；
- Host 的 `webServer` 提供 `/api/dsh-token-control/v1/assets/views/<name>.js`，**只按清单白名单**从包内 `src/client/views/` 读取，防路径穿越；client 启动时用同源 `<script>` 逐个加载（与 DSH 自身注入 bundle 的方式一致，无 eval）。

**修订 2 — DSH settings 的 Config 采用“可降级”加载**
`@deepseek-ai/schemastery` 是 DSH 随包（`dshmarket` 以 peerDependency 方式直接 import 并在本机正常工作），但本机离线无法为新包安装它。因此 `Config` 用 `await import()` 动态取；取不到时**不阻塞插件**，Config 退化为无 schema（`apply(ctx, rawConfig)` 仍会拿到 YAML 行里的 `config`，插件自己校验并夹紧）。
数值调优（余额刷新间隔）因此在两处都可用：DSH 自动表单（能取到 schemastery 时）+ 本插件自己的设置页（任何情况都可用）。这条会写进 README 的「已知降级」。

**修订 3 — 金额一律用「微元」整数累加**
`microCNY = round(单价元/百万tokens × tokens)`（推导：`元/1e6 × tokens × 1e6 = 单价 × tokens`），全程整数，展示时才除以 1e6，避免浮点累计误差。
