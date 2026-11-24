# Meta POS 设备分配与激活改造

本仓库收录运营平台 Demo、三端 PRD、业务场景与评审过程。设备按设备号先分配，现场人员在 Meta POS 核对后激活。实施、运营和 AE 可以按各自权限查结果、处理异常和维护设备。

## 接手入口

| 要做什么 | 从哪里开始 |
|---|---|
| 继续评审或开发 | [接手说明](docs/meta-pos-activation-handoff.md) · [Agent 协作约定](AGENTS.md) |
| 查当前功能、状态和验收 | [设备分配与激活 PRD V0.2](docs/meta-pos-device-activation-prd.md) |
| 查关键决定、修改原因和历次方案 | [评审过程与决策记录](docs/meta-pos-activation-process.md) |
| 查业务场景和角色交接 | [业务 BRD V0.2](docs/meta-pos-device-activation-brd-business.md) · [初版 BRD V0.1](docs/meta-pos-device-activation-brd.md) |
| 核对运营平台交互 | [在线 Demo](https://lch6s.github.io/spa/pos-device-allocation/) · [Demo 源码](pos-device-allocation/) |
| 核对 Meta POS 操作 | [正常激活流程原图](docs/assets/meta-pos-device-activation-prd/pos-device-activation.png) · [设置页单独激活银行卡流程原图](docs/assets/meta-pos-device-activation-prd/pos-settings-bank-card-activation.png) |

## 本地运行 Demo

在仓库根目录执行，使用浏览器打开 `http://127.0.0.1:8000/pos-device-allocation/`。

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Demo 使用示例数据和当前浏览器的本地存储。可用独立浏览器会话复现初始状态。实际 POS、CRM 和服务端集成按 PRD 与联调结论推进。
