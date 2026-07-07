# Harness 与系统检查

Harness 是 kos 的确定性执行层。Skill 负责理解用户意图和组织流程；Harness 负责路径、frontmatter、状态、权限和评估这类不应靠临场发挥完成的检查。

Harness 不绑定 Hermes。Hermes Agent、Codex、Claude Code 都应该通过同一套 harness 操作同一个 vault。

## 为什么需要 Harness

只靠 Skill 文本执行会有三个问题：

- 路径和字段容易漂移。
- 状态流转和人工确认边界容易被跳过。
- 每次 Agent 执行结果难以复查。

Harness 把这些规则变成可重复运行的脚本。用户不需要理解所有实现，但应把 Harness 结果当作系统健康状态的依据。

## 常用检查

在 vault 根目录运行：

```bash
python3 90_系统/harness/generate_health_report.py
```

它会汇总路径、schema、状态、权限、Skill 和 Skill eval 定义检查，并写入：

```text
90_系统/harness/reports/health_report.md
```

也可以单独运行：

```bash
python3 90_系统/harness/validate_paths.py --format markdown
python3 90_系统/harness/validate_schema.py --format markdown
python3 90_系统/harness/validate_state.py --format markdown
python3 90_系统/harness/validate_permissions.py --format markdown
python3 90_系统/harness/validate_skills.py --format markdown
python3 90_系统/harness/validate_skill_evals.py --format markdown
```

## 创建类 Harness

以下脚本用于创建或更新 kos 对象：

```text
create_concept.py
create_extract.py
create_method.py
create_project.py
create_reflection.py
create_research.py
create_signal.py
create_watch.py
generate_daily_dashboard.py
generate_diary.py
summarize_source.py
update_project.py
```

优先让 Skill 或 agent adapter 调用这些脚本，而不是让 Agent 自己拼路径和 frontmatter。

## Runtime 与开发 Harness

用户 vault 里只有 runtime Harness：

```text
90_系统/harness/
```

它负责检查和操作当前 kos vault。

kos-framework 源仓库里的 `dev/` 是开发框架用的 Harness、测试和发布检查，不属于用户 runtime vault，也不会复制到用户 vault。

## 失败时怎么处理

处理顺序：

1. 先读 health report 的错误区。
2. 如果是路径缺失，运行或补齐框架预置目录。
3. 如果是 schema 错误，修正对应笔记 frontmatter。
4. 如果是权限错误，检查是否存在 AI 不应自动推进的状态。
5. 如果是 Skill 错误，先修 `SKILL.md` metadata，再运行 Skill eval。

不要在检查失败时继续让 Agent 批量改写整个 vault。先定位具体文件，再局部修复。
