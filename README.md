# Loopra 插件

[Loopra](https://github.com/ezdemo/loopra) 的公开插件源。

| 插件 | 目录 | 功能 |
| --- | --- | --- |
| 聊天猫娘 | [chat-neko](plugins/chat-neko/) | 只在纯聊天中追加猫娘人物设定，可设置称呼 |
| 每日回顾 | [daily-review](plugins/daily-review/) | 回顾清单、设置页、侧栏、技能、子代理和定时任务 |
| OpenAPI | [openapi](plugins/openapi/) | 管理 OpenAPI / Swagger 文档，搜索接口、查看参数并调用 |
| 上下文透视 | [context-lens](plugins/context-lens/) | 查看请求前的实际上下文和会话历史，固定补充上下文、折叠工具结果 |

## 安装

使用支持 GitHub 插件源的 Loopra，在 **设置 → 插件 → 发现插件** 中选择本仓库，点击对应插件的「安装」。没有默认源时，添加：

```text
https://github.com/ezdemo/loopra-plugins
```

也可以在插件安装框直接填写某个插件目录：

```text
https://github.com/ezdemo/loopra-plugins/tree/main/plugins/chat-neko
https://github.com/ezdemo/loopra-plugins/tree/main/plugins/daily-review
https://github.com/ezdemo/loopra-plugins/tree/main/plugins/openapi
https://github.com/ezdemo/loopra-plugins/tree/main/plugins/context-lens
```

在「已安装」中启停、设置或卸载。卸载会删除该插件的文件、配置和数据；移除插件源会保留已安装插件。

OpenAPI 使用 Loopra 宿主的 `openapi` 服务；上下文透视使用 `sessions` 服务和 Native 请求观察钩子。这两个插件需要支持相应宿主能力的 Loopra 版本。

## 开发

每个插件位于 `plugins/<名称>/`，包含具有唯一 `name` 的 `package.json` 和入口文件；设置页、图标等资源随目录一起发布。Loopra 自动扫描，无需额外维护索引。

```sh
npm ci
npm test
```

测试覆盖上下文快照、会话隔离和 OpenAPI 页面行为。测试中的宿主页面接口使用模拟实现。

需要运行 Go 宿主集成测试时，将本仓库与 Loopra 克隆到同一级目录：

```text
Code/
  loopra/
  loopra-plugins/
```

然后在 Loopra 中运行 `go test ./internal/service/plugin ./internal/controller`。也可将 `LOOPRA_PLUGIN_SOURCE_DIR` 指向本仓库根目录。

插件从 Loopra 主仓库迁入，保留 MIT 许可，见 [LICENSE](LICENSE)。
