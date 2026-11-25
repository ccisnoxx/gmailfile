# 验证代码，再验收具体实例

测试使用合成数据和独立资源。真实域名、路由、日志、镜像 ID、证书时间及生产结果只保存在私有台账。
公开仓库保留可重复的方法，不发布现场验证记录。

## 本地代码检查

使用锁文件安装后，在项目根目录运行：

```sh
make check
make test
make generate-api
git diff --exit-code -- docs/openapi.json frontend/src/api/generated
```

数据库集成测试另行配置 `TEST_DATABASE_URL`，库名必须以 `gm_test` 开头，再运行 `make test-db`。
测试创建随机独立 schema，不清空公共 schema，也不连接生产数据库。
生成契约不需要真实 Secret；不要手工修改生成客户端来消除差异。

前端关键交互：`cd frontend && pnpm test:e2e`。
这些 E2E 使用 API 响应桩，不替代真实联调、剪贴板权限或原生标签隐藏行为的检查。
认证测试不录制密码、TOTP、恢复码、Cookie、截图或 trace。

## PostgreSQL 18 与 Linux 容器

原生 PG17 的兼容测试不替代 PG18。使用独立项目、库、卷、网和合成 Secret，禁止宿主机端口与自动重启。
`infra/docker-compose.acceptance.yml` 仅用于隔离验收，需显式设置批次和独立目录。
`scripts/acceptance_checks.py` 检查迁移、合成数据和实际 Secret 权限；身份路径检查需在私有侧与实例配置同步定制。

A/B 门禁通过后，`scripts/acceptance_schedule.py` 才观察现有 backup 服务的一次自然调度。
它不新增调度器、不修改时钟；错过指定日期不自动顺延，同批结果不覆盖。
完成、失败或超时后停止本批所有运行成员（含 one-off），并复查实际状态；不停止正式服务。

## 实例验收分别记录这些状态

- 应用与迁移测试通过。
- 容器实际以非 root 读取所需只读 Secret；常驻 backup 没有解密私钥和数据密钥。
- API/PG/backup 启用且健康，API 宿主机回环真实可达，PG 不公开。
- 手工备份成功。
- 首次正式自然调度成功。
- 异地副本可取回。
- 在独立新 PG18 集群恢复成功：全表计数、schema/约束及各密钥版本业务字段认证解密。
- age 身份、全部历史数据密钥和管理员恢复码已分别离线保存并由持有人确认。

这几种证据不能互相代替。失败、未执行或待用户操作要写明，不把隔离验收记为生产通过。
完整功能要求见 [25 项验收标准](acceptance-matrix.md)；部署前检查见 [环境检查](deployment-environment.md)。
