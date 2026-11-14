# dsh-ubuntu-packaging

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）的 Ubuntu/Debian 源码包工具包：六个 Host 工具加 `ubuntu-packaging` 技能，覆盖 `debian/` 的检查、静态检查、骨架生成、构建规划、测试规划与构建日志诊断。

按设计，除 `ubuntu_scaffold_package` 只写入 `<sourceDir>/debian/` 之外，其余工具均为只读。六个工具都不会启动 shell、不会访问网络：构建计划只是计划，测试计划只是计划，诊断只是读你递过来的日志。

[English](README.md) | 简体中文

## 安装

安装到 `web` 或 `desktop` profile 均可，命令只差 profile 名。

### 从 GitHub 安装

```sh
dsh plugin --profile web add github:HougeLangley/dsh-ubuntu-packaging
```

### 从 v0.1.0 Release tarball 安装

```sh
curl -LO https://github.com/HougeLangley/dsh-ubuntu-packaging/releases/download/v0.1.0/dsh-ubuntu-packaging-0.1.0.tgz
dsh plugin --profile web add ./dsh-ubuntu-packaging-0.1.0.tgz
```

`dsh plugin add` 也可以直接接受 Release URL，不必先下载到本地。

### 从本地目录安装

```sh
git clone https://github.com/HougeLangley/dsh-ubuntu-packaging.git
dsh plugin --profile web add ./dsh-ubuntu-packaging
```

### 从 Plugins 页面安装

打开 **Settings → Plugins**，通过添加插件入口填入 `github:HougeLangley/dsh-ubuntu-packaging`、Release 的 `.tgz`，或本地检出目录的路径，然后启用。

以上任一方式安装后都需要重启 `dsh web`（或桌面端）。bundle 是 ESM，没有构建步骤。可选的 `@deepseek-ai/dsh-tools` peer 依赖缺失时只会告警，激活不会失败，技能仍会加载。

## 环境要求

- **dsh** 0.2.1-rc.5 及以上（0.2.x 系列）；**Node.js 22 及以上**（仅 ESM，无 TypeScript，无构建步骤）。
- 真实构建与包测试需要 **Ubuntu 22.04 及以上**（或 Debian 衍生版）。工具本身只做文件读写，在 dsh 能运行的任意系统上都能用。
- 目标基线：**Ubuntu 26.04 LTS "resolute"**，是 lint 与各计划的默认值。行为有差异时会单独标注 Ubuntu 25.10 "questing" 与 24.04 LTS "noble"。
- 真实构建与测试需要宿主机上的 Ubuntu 工具链，并以 root 安装：`dpkg-buildpackage`、`sbuild`、`lintian`、`autopkgtest`。各计划会列出自己需要的前置依赖。Ubuntu 25.10 及以上推荐使用 sbuild 的 `unshare` backend，`schroot` 已不再推荐。

## 工具

| 工具 | 作用 | 联网 | 写文件 |
| --- | --- | :---: | :---: |
| `ubuntu_inspect_package` | 解析 `debian/`，返回归一化视图：布局、changelog、deb822 `control`、`rules`、`source/format`、DEP-3 补丁与 DEP-8 测试，以及检查出的 lint 问题。 | 否 | 否 |
| `ubuntu_lint_package` | 按稳定的 lintian 兼容标签做静态检查：缺失的 `debian/` 文件、changelog 与 control 不一致、debhelper compat、`Rules-Requires-Root`、DEP-5 copyright、`debian/watch`、quilt series 与 DEP-8 测试。`strict: true` 时 warning 也算失败。 | 否 | 否 |
| `ubuntu_scaffold_package` | 生成经过校验的 `debian/` 骨架：control、rules、changelog、DEP-5 copyright、`source/format`，给定 homepage 时生成 watch 文件，启用测试时生成 DEP-8 smoke 测试。已存在 `debian/` 时拒绝写入，除非传 `overwrite: true`。 | 否 | **是，仅 `<sourceDir>/debian/`** |
| `ubuntu_build_plan` | 生成有序的构建计划：工具安装、源码准备、`sbuild` / `dpkg-buildpackage` / `debuild`、产物检查、lintian、签名与上传注意事项。 | 否 | 否 |
| `ubuntu_test_plan` | 生成测试计划：lintian、安装/冒烟/卸载/清理、DEP-8 `debian/tests`、LXD、QEMU 与 PPA 上的 `autopkgtest`，以及失败排查。 | 否 | 否 |
| `ubuntu_diagnose_build` | 读取构建日志（内联文本或你给的日志路径），返回带证据、原因、具体修改与文档链接的结论。 | 否 | 否 |

所有工具都接受绝对路径或相对当前工作目录的路径，报错会指名文件与规则。

## `ubuntu-packaging` 技能

bundle 还会注册运行时技能 `ubuntu-packaging`，让 agent 不必再查资料就能跑完整条链路：resolute/questing/noble 基线、源码包与二进制包、版本号规则、用 `dpkg-buildpackage` / `sbuild` / `debuild` / `gbp` 构建、用 `lintian` / `autopkgtest` / `piuparts` / `reprotest` 测试、PPA 与 archive 发布流程、FTBFS 与 autopkgtest 修复手册、changelog 纪律、DEP-3 补丁、DEP-5 copyright、`debian/watch`，以及故障排查表。参考资料在 `skills/ubuntu-packaging/references/`。

## 示例提示词

**上传前检查现有包**

> 检查 `./hello-2.10`，告诉我评审会卡在哪里：changelog 与 control 不一致、debhelper compat、缺失的 DEP-5 字段、格式有问题的补丁。然后把你能修的 lint 错误修掉。

**生成 `debian/` 骨架**

> 为 `./hello-2.10` 生成 `debian/`：包名 `hello`，上游版本 2.10，`-0ubuntu1`，目标 `resolute`，维护者 `Jane Doe <jane@example.com>`，homepage `https://www.gnu.org/software/hello/`，license `GPL-3+`，autotools 构建，并带一个 DEP-8 smoke 测试。

**诊断失败的构建**

> 这是我的 sbuild 日志。为什么失败？`debian/control` 里缺哪条 `Build-Depends`？具体该改哪个文件？

## 安全与副作用

- **不执行 shell。** 六个工具都不会启动进程。构建计划与测试计划是文本，由你或 agent 自己执行。
- **不联网。** 没有工具会下载源码、查询 Launchpad、运行 `uscan` 或上传任何东西。`ubuntu_scaffold_package` 也不会去取上游 tarball。
- **写入面只有一个目录。** `ubuntu_scaffold_package` 只写 `<sourceDir>/debian/` 内部，已存在 `debian/` 且未传 `overwrite: true` 时拒绝写入。
- **读取面止于你指定的位置。** 检查与 lint 读取包目录；`ubuntu_diagnose_build` 只读你给的内联日志或日志路径，不会去拉远端日志。
- **不自动修复、不自动上传。** 结论里给出具体改法，改不改由你决定；签名与上传都不会代做。

## 仓库结构

```text
package.json            bundle manifest、dsh.bundle patch、测试脚本
cordis.patch.yml        插入 ubuntu-packaging 插件
lib/
  index.js              激活、六个工具、技能注册
  parse.js              deb822、changelog、rules、series、DEP-8 解析
  lint.js               lintian 兼容规则
  scaffold.js           debian/ 生成器
  buildplan.js          构建计划
  testplan.js           测试计划
  diagnose.js           构建日志排查
skills/ubuntu-packaging/
  SKILL.md              agent 遵循的方法论
  references/           debian-reference、build-test-release、fix-playbook、sources
docs/                   DETAIL.md、preview.svg、MARKETPLACE.md、SOURCES.md
locale/                 en.json、zh.json
tests/                  解析、lint 与工具的 node:test 套件
```

## 开发

Node.js 22 及以上，无需安装步骤：

```sh
npm test                                   # node --test "tests/**/*.test.mjs"
node --check lib/index.js
```

测试套件使用内置的 `node:test` 运行器与固定样例包，不需要 Ubuntu 工具链；工具测试断言解析结果与生成的 `debian/` 文本。

## 许可证

MIT © 2026 HougeLangley，见 [LICENSE](LICENSE)。变更记录见 [CHANGELOG.md](CHANGELOG.md)，市场投稿材料见 [docs/MARKETPLACE.md](docs/MARKETPLACE.md)。
