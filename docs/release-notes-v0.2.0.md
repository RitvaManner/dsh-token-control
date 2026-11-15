# dsh-token-control v0.2.0

**English** — Balance without an API key. A profile signed in through the DeepSeek account now shows its CNY wallet too: the plugin asks DeepSeek Harness's own account service for the same recharge and bonus wallets the settings page shows. Everything from 0.1.0 stays as it was, including the readout, pricing, peak windows, and the API-key source when a key exists.

---

## 这个版本做了什么

0.1.0 的余额只有一条来源：`DEEPSEEK_API_KEY`。桌面版用户通常是用 DeepSeek 账号登录的，profile 里根本没有 `sk-` 开头的 key，读数带就一直显示「未配置 API Key」——数据明明在 DSH 设置页里看得到。

0.2.0 把这条断掉的路接上：

```
余额 ¥7.77 (刚刚)          ← 之前：余额 未配置 API Key
```

| 改动 | 说明 |
|---|---|
| 新增 `AccountBalanceProvider` | 通过 Host 的 `ctx.get('deepseekAccount')` 调 `getBalance(client)`，把**充值钱包 + 赠金钱包**的 CNY 余额相加；平台授权由 DSH 自己保管，插件只拿到金额 |
| 新增 `FallbackBalanceProvider` | 有 key 时 key 说话；**只有** `no-credential` 才换账户来源，其他失败原样抛出，所以配了 key 的 profile 行为逐位不变 |
| Host 装配 | 余额 seam 由单个 provider 变成「key → 账户」的回退对；路由、ViewModel、Client bundle 一行未改 |
| 测试 | 新增 10 条断言（钱包求和与取整、登出/失败/畸形响应的错误码、client 元数据透传、回退只在 `no-credential` 触发、有 key 时不换源），共 57 条 |

## 安装 / 升级

```sh
dsh plugin --profile <profile> add dsh-token-control        # npm，0.2.0 起可用
dsh plugin --profile <profile> add github:RitvaManner/dsh-token-control
```

从 0.1.0 升级不需要任何迁移动作：装上新版本、刷新页面即可。**有 `DEEPSEEK_API_KEY` 的 profile 读数来源不会变**（仍是 `/user/balance`），只是多了一条「没 key 也能读」的兜底。

## 余额口径（这个版本必读）

| profile 状态 | 余额来源 | 结果 |
|---|---|---|
| 配了 `DEEPSEEK_API_KEY` | `GET https://api.deepseek.com/user/balance` 的 CNY `total_balance` | 与 0.1.0 完全一致 |
| 没 key，用 DeepSeek 账号登录 | DSH 账户服务：`getBalance(client)` 的充值钱包 + 赠金钱包（CNY 合计） | 显示账户钱包合计 |
| 没 key，也没登录 | 两者都答 `no-credential` | 显示「未配置」，**绝不伪造数字** |
| 账户服务不可用（精简 profile） | 同上 | 降级为「未配置」，插件照常工作 |

失败时依旧保留上一次读数并标「已过期 + 最后更新时间」，不会把余额清零。

## 已知限制

1. **流式期间的输出 token 是估算**（`≈`）——DeepSeek 只在流末尾上报 usage。
2. **账户余额来自 DSH 的账户服务**：服务不存在或账户过期时，读数带回到「未配置」；插件不会自己存 token，也无法绕过 DSH 的登录态。
3. **余额与模型消费不同源**：两条来源都含赠金与 Search/Fetch 扣费；插件的差值校准做了平滑与夹紧，仍可能有残差。
4. **路由只绑定回环地址，但注册在 DSH `/api` 连接鉴权之外**：同机进程可读取快照（含余额，绝不含 key 或平台授权）。
5. **与内置 usage 行并存**：读数带挂在 `conversation.input.dock`，不替换 DSH 自带的统计行。
6. **当前只有一个 View（读数带）**：新增 View = 新文件 + `views/index.json` 一行 + `pnpm build`。

## 本版验证

- 57 条单元断言全通过（`node --test tests/`），其中新增 10 条覆盖账户来源与回退选择。
- 架构检查通过（`node scripts/check.mjs`）：provider 只依赖 definition，Host 保持 UI 无关，Client bundle 与源码同步。
- desktop profile 实机：`POST /api/dsh-token-control/v1/balance/refresh` 返回
  `{"state":"ok","cny":7.7668,"source":"deepseek-account"}`，读数带显示「余额 ¥7.77」；同一次运行里快照的 `balance.source` 为 `deepseek-account`。
- 无 key 路径不发起任何 DeepSeek 请求：账户 provider 只调用 Host 服务，测试断言它不接触 credentials。

## 升级说明

- 0.1.0 → 0.2.0：直接安装即可，无配置迁移、无数据目录变更、ViewModel 字段只增不改（新增的只是 `balance.source` 的取值 `deepseek-account`）。
- 之前若手动改过 `node_modules/dsh-token-control` 里的余额代码（社区里的常见补丁），装本版前请先还原或重装该插件，否则 `src/` 会是旧文件。
- 上一版说明见 [release-notes-v0.1.0.md](https://github.com/RitvaManner/dsh-token-control/blob/main/docs/release-notes-v0.1.0.md)。

## 反馈

问题与建议请提到 <https://github.com/RitvaManner/dsh-token-control/issues>，附上 DSH 版本、平台与 `[dsh-token-control]` 开头的控制台日志会更快定位。
