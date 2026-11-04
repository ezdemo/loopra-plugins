# Loopra 插件

[Loopra](https://github.com/ezdemo/loopra) 的公开插件源。

| 插件 | 目录 | 功能 |
| --- | --- | --- |
| 聊天猫娘 | [chat-neko](plugins/chat-neko/) | 只在纯聊天中追加猫娘人物设定，可设置称呼 |
| 每日回顾 | [daily-review](plugins/daily-review/) | 回顾清单、设置页、侧栏、技能、子代理和定时任务 |
| OpenAPI | [openapi](plugins/openapi/) | 管理 OpenAPI / Swagger 文档，搜索接口、查看参数并调用 |
| 上下文透视 | [context-lens](plugins/context-lens/) | 查看请求前的实际上下文、分类用量和会话历史 |
| 回复风格 | [reply-style](plugins/reply-style/) | 在系统提示词末尾追加回复风格：预设（简洁、详细、结论先行、要点式、口语、严谨）与自定义要求可任选其一或同时使用 |

## 安装

使用支持 GitHub 插件源的 Loopra，从侧栏进入 **技能与插件 → 插件 → 发现**，选择本仓库，点击对应插件的「安装」。顶部默认选中「插件」，另一个选项是「技能」。没有默认源时，添加：

```text
https://github.com/ezdemo/loopra-plugins
```

也可以在插件安装框直接填写某个插件目录：

```text
https://github.com/ezdemo/loopra-plugins/tree/main/plugins/chat-neko
https://github.com/ezdemo/loopra-plugins/tree/main/plugins/daily-review
https://github.com/ezdemo/loopra-plugins/tree/main/plugins/openapi
https://github.com/ezdemo/loopra-plugins/tree/main/plugins/context-lens
https://github.com/ezdemo/loopra-plugins/tree/main/plugins/reply-style
```

在「插件 → 我的内容」中启停、设置、更新或卸载，发现页也可以直接更新、卸载已安装的外部插件。安装、更新和卸载保留当前列表与滚动位置。手动填写来源时使用「添加 → 安装插件」。卸载会删除该插件的文件、配置和数据；移除插件源会保留已安装插件。

### 更新已安装插件

使用支持插件更新的 Loopra，在「我的内容」中点击插件卡片的更新图标，或在「发现」中点击「更新」。宿主从原安装来源获取新版，保留配置、持久数据、安装顺序和启停状态；失败时保留旧版，可重试。成功后显示自动消失的顶部通知，不占插件列表位置。刷新列表不会更新已安装插件。

本仓库的 `tree/main/plugins/...` 来源会重新读取同一插件目录的 `main` 分支；安装时指定了其他分支或标签，则保留该 ref，不会自动切换到新标签。npm 来源更新到 `latest`，本地来源重新读取原路径。若要切换来源或 ref，可用「添加 → 安装插件」填写新的地址；内置插件随 Loopra 更新。接口和完整规则见[更新与版本](https://github.com/ezdemo/loopra/blob/main/docs/PLUGIN.md#更新与版本)。

OpenAPI 使用 Loopra 宿主的 `openapi` 服务；上下文透视使用 `sessions` 服务和 Native 请求观察钩子。这两个插件需要支持相应宿主能力的 Loopra 版本。

上下文透视使用容量网格展示上下文，支持按类别筛选和展开全部内容。重复工具结果和同一轮消息合并显示，点开后可选择各个原始片段。底部曲线展示最近保留请求的文本估算趋势，概览自动跟随最新请求。仅保留网格展示，已移除视图切换和概览中的“快照与设置”区域。

支持 `sessions/usage` 的宿主会提供模型窗口、最近一次已完成请求的上下文计数和本会话累计缓存命中率；发送中的新请求使用文本估算，直到对应统计更新。未上报窗口或缓存时显示未知，不推断容量或命中率；旧版宿主仍可查看快照。分类用量始终为文本估算，不包含媒体及协议开销。

`1.2.4` 中每个非空文本分类至少显示一格，小分类所需格子优先从剩余空间扣除。网格用于概览，实际用量以图例中的 token 数为准。

`1.2.5` 默认铺满面板高度，模型信息并入用量区，较高面板会自动展示更多内容条目。插件只读查看上下文，已删除固定、折叠功能和请求改写钩子；旧版保存的相关设置不再生效。

`1.2.6` 将详情中的 JSON 显示为语法高亮的代码树，默认收起对象、数组与长字符串，点击可逐层展开。普通文本或截断后无法解析的 JSON 仍显示原文；展示展开状态不会修改模型请求。

`1.2.7` 的轮次条目汇总该轮用户消息、助手内容、请求携带的推理记录、工具调用及全部工具结果（包含文件读取）。共享系统提示词与工具定义单独统计。点击轮次可查看其中各个原始片段；顶部分类图例仍按互不重复的内容类别统计。

纯聊天也能通过右上角开关打开右侧栏，显示「能力」和已启用插件的面板，例如上下文透视；文件、Git 只在项目中显示。插件面板通过 `loopra.context` 和 `loopra.onContext()` 跟随当前会话。

纯聊天现支持技能选择、`/skills`、`/terminal`、一次性命令和交互终端。命令默认在系统临时目录执行，提示词仅允许操作临时目录、技能目录与配套资源，并保留现有工具审批。聊天猫娘 `1.0.1` 已移除旧的禁止命令、禁止技能提示；已安装 `1.0.0` 时，点击插件的「更新」获取新版，保留原来的称呼配置；旧版宿主没有更新按钮时，也可从「添加 → 安装插件」填写上面的 GitHub 地址覆盖安装。

## 多插件协作

多个插件的 `systemPrompt.append` 按顺序累加，不再互相覆盖。聊天猫娘的人设和 OpenAPI 的接口规则可以同时保留，上下文透视只观察请求。旧版宿主需要更新并重启 Loopra，已有插件不用重装。

插件可在入口模块的 `meta.hookPriority` 中为同名 Hook 声明整数优先级，数值小的先执行，默认 `0`，同级按安装顺序。它不改变 Hook 阶段顺序：全部 `systemPrompt` 完成后才执行 `llmRequest`，`llmRequestSent` 只读观察最终请求。

```js
export const meta = {
  displayName: "我的插件",
  hookPriority: { systemPrompt: -10, llmRequest: 20 }
};

export function systemPrompt(input) {
  return { append: "\n补充规则。" };
}
```

`input.text` 包含此前的追加内容，只补充规则时不要把全文再次放进 `append`。返回 `text` 会明确替换当前系统提示全文；`llmRequest` 返回 `system` 或 `body` 同样是替换，需要自行保留输入中的既有内容。优先级写在模块的 `meta` 中，不是 `package.json`。

## 开发

每个插件位于 `plugins/<名称>/`，包含具有唯一 `name` 的 `package.json` 和入口文件；设置页、图标等资源随目录一起发布。Loopra 自动扫描，无需额外维护索引。

完整开发规范见 [Loopra 插件文档](https://github.com/ezdemo/loopra/blob/main/docs/PLUGIN.md)，包括安装与更新、图标、工具与纯聊天声明、全部 Hook、设置页和页面后端、侧栏与右侧面板、宿主服务、数据持久化，以及技能、子代理、定时任务贡献。本文保留仓库安装和协作说明，接口细节以宿主文档为准。

发布新版保持 `package.json.name` 不变并更新 `version`；用户更新时会重新加载插件模块，工具和钩子随新版替换。页面通过 `loopra.config.get()` / `set()` 读写持久配置，后端通过输入的 `config` 读取；后端数据写入 `loopra.dataDir`，不要把用户数据保存在会被替换的插件包目录中。

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

然后在 Loopra 中运行 `go test ./internal/service/plugin ./internal/service/agent ./internal/controller`。也可将 `LOOPRA_PLUGIN_SOURCE_DIR` 指向本仓库根目录。宿主测试包含聊天猫娘、OpenAPI 和上下文透视同时启用、安装顺序变化、Hook 优先级和提示词合并。

插件从 Loopra 主仓库迁入，保留 MIT 许可，见 [LICENSE](LICENSE)。
