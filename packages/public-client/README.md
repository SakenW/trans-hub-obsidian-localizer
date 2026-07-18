# @trans-hub/public-client

Trans-Hub 官方客户端的分层装配、Tauri/Native bridge 和 Public/Private 双轨调用顺序见 [Client Core 双轨客户端接入手册](../../../../docs/03-技术实施/技术实施指南/24-client-core-dual-track-integration-guide.md)。

Apache-2.0、平台中立的 Trans-Hub 公共贡献客户端。它只依赖 `@trans-hub/client-protocol`，并把网络、Ed25519、服务端密钥验证、SHA-256、时钟、随机数和 installation 持久化留给宿主实现。

## 信任边界

- `client_type` 只进入 provenance，不增加 authority。
- 控制面只有固定的 Bootstrap 与 Public Contribution Intake（提交和 receipt/status）路径；调用方不能注入任意 authority route。Transfer、Source Submission、Adapter Governance 和 Translation Export 继续由既有权威 API 签发文档，不在本包复制入口。
- Public credential 只能来自严格解析后的 Bootstrap 响应，必须同时声明 `audience: "public-contribution-intake"` 和 `plane: "public"`，并绑定 installation、epoch、短期 expiry 与 capability。`bootstrap()` 忽略调用方伪造的额外 credential 字段；没有 credential fallback，也不接受 Private credential。
- grant/ticket 的跨 origin URL 只进入 `transport.transfer()`；`TransferHttpRequest` 没有 credential 字段。宿主不得把控制面 header 或 cookie 合并到 transfer 请求。
- 包不包含服务端 authorization、生态文件 parser、官方客户端策略、离线 DAG 或 create/publish authority。

## 宿主端口

宿主创建两个窄客户端：

```ts
import { PublicClient, PublicTransferClient } from "@trans-hub/public-client";

const control = new PublicClient({
  transport,
  signer,
  digest,
  clock,
  random,
  installationStorage,
});

const transfer = new PublicTransferClient({
  transport,
  serverVerifier,
  digest,
  streamingDigest,
  clock,
  random,
});
```

`digest` 实现协议 JSON 的 SHA-256 port；`streamingDigest` 必须以流式方式消费 `AsyncIterable<Uint8Array>`。协议域分隔、JCS、digest/signature frame 和严格 parser 全部来自 `@trans-hub/client-protocol`，宿主不应重新实现。

`signer.signProof()` 只接收 Public Intake 的 request digest、服务端 challenge、nonce 与 credential epoch，并返回签名及受信 `signedAt`；它不再接收任意字节帧。Native 产品应由 Private Native Core 提供 key ID、公钥、受信时钟、规范化证明帧和 Ed25519 签名，产品壳不能选择签名域或替换时间。

`installationStorage` 只保存 Public installation snapshot 与 Bootstrap 下发的短期 Public credential。生产实现应使用适合平台的安全存储，且与 Private credential store 分离。宿主不得向 Bootstrap 注入 user、adapter 或 Private token。

## 控制面流程

1. 客户端先调用 `control.prepareBootstrap()` 生成包含 installation public key、client nonce、客户端元数据与请求 capability 的稳定 binding，并把完整 binding 交给受信 Web 控制面显示和授权。
2. Web 只为该 exact binding 签发短期一次性 linking code；`control.bootstrap()` 必须携带同一个 prepared binding 消费 code，不能在授权后更换 key、nonce 或能力。
3. `control.bootstrap()` 校验响应回显的 client nonce、key ID 与 capability 子集，只保存服务端下发的默认低信任 installation credential。
4. 调用方构造 `ContributionSigningPayload`。`control.submitContribution()` 固定 installation、challenge、nonce、clock 和 credential epoch，计算 request digest 后签名，提交完整 typed `ContributionIntent`。
5. 使用 `getContributionStatus()` 读取严格解析的 receipt。Receipt 的 contribution scope 和提交响应的 command digest 会被校验。
6. grant、manifest 与 ticket 必须来自 Intake receipt/status 或既有权威 API；本包不发明获取路径。`PublicTransferClient` 严格解析和验证其签名、audience、plane、scope、digest、length、expiry 与当前 Bootstrap credential epoch 后才使用。调用方传入的 expected epoch 必须来自当前 installation snapshot，不能从待验证的 grant/ticket 反抄。

Bootstrap 是一次性交换，不自动重试。安全 GET 会有界重试；POST 只有在 API 要求稳定 idempotency identity 时才重试。默认最多 3 次，backoff/jitter 均有上限，所有操作接受 `AbortSignal`。

## 流式传输合同

上传 source 必须实现 `ReopenableByteSource.open()`，每次返回新的 `AsyncIterable<Uint8Array>`，并在一次操作及其重试期间产生完全相同的字节。客户端在 PUT 消费同一字节流时同步计算并校验 grant 的 length/digest，每次重试都会重开 source；不会把对象整体缓存在内存。服务端仍必须独立校验上传内容。

下载 sink 必须实现 `TransactionalDownloadSink.begin()`。客户端边接收边写入 transaction，只有完整 length 与 transport digest 都通过后才调用 `commit()`；HTTP、取消、签名、scope、length、digest 或 sink 失败都会调用 `rollback()`。Sink 必须让 rollback 幂等，并保证未 commit 的数据对消费者不可见。

## 错误与诊断

所有运行时错误归一为稳定的 `PublicClientError.code`。`diagnostic` 只包含 operation、attempt、HTTP status、协议错误码和协议 path，不包含 credential、linking code、签名、payload 或带 query 的 transfer URL。应用日志也不得记录这些敏感值。

## 包边界

发布产物仅包含 `dist/`、本 README 和 Apache-2.0 LICENSE。运行时不得导入 Node built-in、backend 源码或 `@trans-hub/secure-client-core`；对应 architecture test 会持续检查该边界。
