# 交付门 3 验证记录

> 执行时间：2026-11-01 17:06–17:25（Asia/Shanghai）。
> 只记录实际观察到的结果；没测到的写「未验证」，不用推测填充。

## 0. 环境

| 项 | 值 |
|---|---|
| Harness | 0.2.1-rc.5（boot graph `release.version`） |
| Node | v24.21.0（Electron 内置，`ELECTRON_RUN_AS_NODE=1`） |
| 隔离 home | `D:\deepseek\workspace\默认工作区\dsh-token-control\.dsh-dev` |
| profile | `dev`（从随包 `web` 模板创建，`dsh.profile.bundles` = base + web-app + dsh-token-control） |
| 端口 | `http://127.0.0.1:3080`（与现运行的 Desktop GUI `:53660` 互不影响） |

## 1. 静态检查

| 命令 | 结果 |
|---|---|
| 逐文件 `node --check`（25 个源文件） | 全部通过 |
| `node scripts/check.mjs` | `check passed`；沙箱内子进程被拦，语法项降级为提示，其余 4 组规则实际执行 |
| `node --test tests/`（逐文件运行 5 个） | **36 条断言全通过**：policy 8 / pricing 8 / view-model 8 / balance 7 / architecture 5 |

## 2. 隔离启动与安装

| 步骤 | 实测 |
|---|---|
| `node scripts/dev.mjs --reset --no-start` | 创建 `.dsh-dev/profiles/dev`；pnpm 用本地 store 离线 link（`+ dsh-token-control 0.1.0 <- ..\..\..`）；未触碰 `~/.dsh` |
| `dsh --profile dev --no-open` | 启动成功，打印 `dsh web: http://127.0.0.1:3080/?token=…`；仅有一条无害 stderr（`could not open the default browser because spawn EPERM`，--no-open 时不再出现） |
| Boot graph | `__DSH_BOOT__` 含 `{"id":"dsh-token-control","url":"plugins/??dsh-token-control/client.js&rev=…"}`，且预加载列表含 `dsh-token-control/client.js` |
| Client bundle | `GET /plugins/??dsh-token-control/client.js` → 200，32 091 bytes，含 `__ModuleLoader__.load` 与 `id: 'dsh-token-control'` |

## 3. 路由与数据面（`scripts/probe.mjs`，全部通过）

| 用例 | 实测 |
|---|---|
| `GET /snapshot?sessionId=probe-session` | 200；ViewModel 键序 `schemaVersion,sessionId,turn,session,balance,period,meta` |
| `GET /view-config` | 200；默认 `readout-bar → conversation.input.dock, order 25`；`knownSlots` 3 个 |
| `GET /assets/views/index.json` | 200；1 个 View |
| `GET /assets/views/readout-bar.js` | 200，12 551 chars，含 `register('readout-bar'`、`getConfigSchema`、`supportedSlots` |
| 路径穿越 `..%2F..%2Fpackage.json` | **404** |
| 未知 View 脚本 `nope.js` | **404** |
| `GET /stream` | 200，`text/event-stream; charset=utf-8`，首帧 `event: reset` 且带 `viewModel` |
| `PUT /view-config`（未知 View） | 200，`warnings: ["unknown view \"ghost-view\" ignored"]`，落盘时丢弃未知项 |
| `PUT /view-config`（非法 JSON） | **400** |
| 持久化文件 | `<DSH_HOME>/dsh-token-control/views.json` 内容与 GET 一致；测完已还原默认值 |

## 4. 真实会话端到端（关键证据）

把一份**真实的会话日志**（`session-04556bb2-…`，v4 jsonl.zstd）拷进隔离 home，再向 Host 请求快照：

```json
"turn": {
  "index": 1, "state": "settled",
  "tokens": { "input": 10063, "output": 40, "cacheHit": 9472, "cacheMiss": 591,
              "cacheWrite": 0, "reasoning": 0, "total": 10103, "estimated": false },
  "cost": { "cny": 0.00094, "settled": true, "basis": "table" },
  "models": ["deepseek-flash"]
},
"period": { "kind": "idle", "calendarYear": 2026, "estimated": false,
            "remainingSeconds": 57048, "upcoming": "peak" },
"balance": { "state": "error", "cny": null, "error": { "code": "no-credential" } }
```

核对：

- **token 语义**：`input 10063 = cacheHit 9472 + cacheMiss 591`，`total = 10063 + 40` —— 没有把 `inputTokens` 当成 prompt 总量。
- **金额口径**：按**调用时刻**用高峰价 `591×1 + 9472×0.02 + 40×4 = 591+189+160 = 940` 微元 = `0.00094`；若按当前空闲价应为一半（470 微元）。当前 `period.kind = idle` 而金额是高峰价，恰好证明「结算按调用时刻选峰/谷」生效。
- **峰谷**：2026-11-01 是周日 → 空闲；下一次切换 57 048 s ≈ 15.85 h 后 → 2026-11-02（周一）09:00 进入高峰。
- **余额**：隔离 home 没有 `DEEPSEEK_API_KEY` → `error/no-credential`，不伪造金额、不崩。
- **回填**：该会话在 Host 启动后才出现，仍能被读到并正确折叠（`readSession` 冷读路径）。

## 5. 热重载

| 改动 | 实测 | 结论 |
|---|---|---|
| View 脚本（`views/readout-bar.js`）加一行注释 | 未重启服务，下一次 `GET /assets/views/readout-bar.js` 立即返回新内容（12 536 → 12 564 chars）；恢复后回到原内容 | **View 资产刷新页面即生效**（路由按请求读盘） |
| Host 代码（`src/host/*`、`src/provider/*`） | 未单独实测 | 需重启 dev 进程（ESM 模块缓存），不宣称 HMR |

## 6. 卸载

| 步骤 | 实测 |
|---|---|
| `dsh plugin --profile dev remove dsh-token-control` | pnpm 移出依赖（`node_modules/.ignored/…`），bundle 从 `dsh.profile.bundles` 移除 |
| 重启后访问插件路由 | 返回 **401**（该前缀已无自有路由，落到 DSH `/api` 鉴权）→ 路由已释放 |
| 重启后 boot graph | 不再包含 `dsh-token-control` |
| 重新 `add` 并重启 | 路由、SSE、manifest 全部恢复，`probe passed` |

## 7. 未验证（诚实清单）

1. **浏览器视觉**：本机无浏览器控制能力，未看到读数带的实际渲染、槽位占位、主题 token 效果、设置页表单。
2. **真实轮次的流式数字**：没有向 dev 实例发送对话的通道（未驱动 UI），`agent/assistant-stream` 的实时覆盖只有单测覆盖。
3. **余额成功路径**：隔离 home 无 API Key，只验证了失败路径（保留旧值 / `no-credential`）。
4. **DSH 自动设置表单**：`@deepseek-ai/schemastery` 在 profile 插件里能否解析未直接观测；解析失败时按设计降级（`Config` 为 undefined，插件自身设置页仍可用）。
5. **多 View 并存**：只交付了一个 View；Registry 的多槽位/多 View 逻辑由单测与代码检查覆盖，无实例。

## 8. 安全观察（需要你知情）

插件的 HTTP 路由注册在 `webServer` 的**自有前缀**上，绕过了 DSH `/api` 的连接鉴权（`connection.admit`）。在本机 `127.0.0.1` 绑定下，同机进程可直接读取快照（含余额，但不含 key）。这与已安装社区插件的做法一致；若要更严，可后续用 `ctx.connection.admit(req)` 包裹路由（会要求浏览器携带 DSH cookie，需实测后再改）。

## 9. 门 3 之后发现并修复的缺陷

**现象**：用户看不到读数带。

**两个叠加原因**

1. 插件此前只装在隔离 `.dsh-dev`，用户正在使用的 desktop profile（`:53660`）里没有它 —— 已通过 `plugin_manager` 安装，`application: applied`。
2. 我用 PowerShell 做换行规范化时，误把 `src/client/views/readout-bar.js` 按 GBK 读入再写回：中文、`¥`、`≈` 全部变成乱码，其中 `'≈'` 的收尾引号被吞掉 → `SyntaxError` → View 脚本永远不会注册 → 槽位虽在但没有内容。

**修复**

- 用原始内容重写 `readout-bar.js`，**非 ASCII 一律写成 `\uXXXX` 转义**，从根上避免编码往返破坏。
- 客户端不再静默失败：View 未注册时显示红字「视图脚本未加载」，挂载抛错时显示「视图挂载失败」；配置接口不可达时回退到内置布局而不是空布局；`console.info` 打印 manifest / 已注册 View / 布局。
- 新增 `tests/readout-bar.test.mjs`：用最小 DOM 桩真实执行 View 的 `mount/update/unmount`，断言 token 拆分、金额、余额、过期标注、估算标记、卸载清理、schema 与槽位声明（6 条断言）。
- `scripts/check.mjs` 增加乱码绊线（这批字符只会出现在编码损坏时），并保留语法检查。

**复验**

- 单测 47 条断言全通过（architecture 5 / balance 7 / client-bundle 5 / policy 8 / pricing 8 / readout-bar 6 / view-model 8）。
- `:53660` 上 `GET /assets/views/readout-bar.js` → 200、12 703 chars、可解析、无乱码。
- `Slots.listSubTree(conversation.input.dock)` → `{"registrant":"dsh-token-control","id":"token-control:readout-bar","order":25,"active":true}`。
- `Slots.listSubTree(settings.section)` → `{"registrant":"dsh-token-control","order":27,"active":true}`。
- `:53660` 上真实会话快照：`turn.total 10103 / cost 0.00094 / settled true`，`balance.state ok / cny 2.17`（**余额成功路径在 desktop 上已验证**），`period idle / next 54 909 s`。

## 10. 第二次修复：View 改为构建期内联

**现象（修复 1 之后）**：读数带位置出现红字「Token 监控：视图脚本未加载」——说明 Client bundle 已激活、槽位已注册，但 View 工厂不在 Registry 里。

**根因**：旧实现靠「页面全局钩子 + 运行时 `<script src>`」把 View 接进来。`apply` 在 teardown 里会还原/删除 `window.__DSH_TOKEN_CONTROL_VIEWS__`；插件一旦被激活两次（`immediately` + 热挂载），先退出的实例会把后一个实例刚设置的钩子删掉，随后加载的 View 脚本读不到钩子，静默返回 → Registry 为空。页面无 CSP / 无 nonce，因此不是策略拦截。

**方案**：彻底去掉运行时注入。

- `src/client/core.js` 是 bundle 源码，`apply` 内留标记 `/* __TOKEN_CONTROL_VIEWS__ */`；
- `scripts/build-client.mjs` 按 `views/index.json` 把每个 View 的源码内联到该标记处，生成并提交 `src/client/client.js`；
- 内联代码在 `apply` 的一个**同步块**里临时设置钩子、跑完所有 View 的注册、再还原（且只有钩子仍是自己时才还原），因此重复激活互不影响；
- 运行时不再有 `<script>` 注入、不再有常驻页面全局、不再有加载时序；
- 新增 `tests/client-bundle.test.mjs`：在 vm 沙箱里真实启动整个 bundle，断言「注册 settings.section + conversation.input.dock」「View 已注册」「连续两次激活都注册」「Host 不可达时回退内置布局」；`check.mjs` 校验 `client.js` 与源文件是否同步，防止忘记构建。

**这条路径已验证的部分**：bundle 内联了 `register('readout-bar'`；47 条断言通过；`node scripts/build-client.mjs --check` 显示 up to date。

**仍需你在浏览器确认的部分**：刷新后读数带是否出现（我无法看到页面）。

## 11. 读数带横向对齐

**现象**：读数带渲染成功，但从窗口最左侧开始，与居中的输入框卡片不对齐。

**依据**：DSH 自己的 dock 条目（todo/goal/queue）都用同一组布局变量计算宽度，例如 queue 的根节点：

```css
width: calc(100% - 2×side-clearance - 4×dock-inset);
max-width: calc(composer-card-max-width - 4×dock-inset);
margin: 0 auto;
```

**做法（第一版，已否决）**：`.tm-host` 照抄 `calc(100% - 2×side - 4×inset)`。实测失败：该 dock 是 flex 行，同槽位还挂着 todo/goal/queue（内容为空但仍占 flex 项），百分比宽度被一起挤窄到每行只剩一个 span —— 表现为「每个 `·` 各占一行」。

**做法（第二版，当前）**：不再做百分比减法。

```css
.tm-host { width:100%; min-width:0; flex:0 0 auto; align-self:stretch;
           display:flex; justify-content:center; box-sizing:border-box; }
.tm-rail { width:100%; min-width:0; margin:0 auto;
           max-width: var(--dsh-composer-card-max-width, 100%); box-sizing:border-box; }
```

- `flex: 0 0 auto` + `align-self: stretch`：在行 flex 里不会被兄弟压缩，在列 flex 里也不会被当成 100% 高度。
- 内层 rail 以输入框卡片的最大宽度为上限并居中；变量缺失时退化成整行宽，不会塌。
- 文本内边距 12px，与卡片内容对齐。
- 颜色使用真实 token：`--dsw-alias-label-primary/secondary`、`--dsw-alias-state-warn/error-primary`。

**已知取舍**：卡片宽度下这行较长，可能自然折成两行；需要单行时可开 View 的 `compact`，或把大数字压成 `4.27M`（尚未实现）。
