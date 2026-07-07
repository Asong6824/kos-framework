---
name: kos-end-my-day
description: 根据今日工作台生成或更新当天日记，并保留人工填写区。
version: 1.0.0
metadata:
  hermes:
    tags: [kos, diary, reflection]
    related_skills: [kos-start-my-day, kos-create-concept]
    pinned: true
  kos:
    scope: core
    lifecycle: active
    created_by: human
    promoted: true
    review_required: false
    object_types: [diary]
    external_systems: []
---
# kos-end-my-day

## When to Use

当用户希望结束当天工作、生成日记、整理今日任务快照和待审核内容时使用。

## Prerequisites

- 当前工作目录应为包含 `.kos.md`（或兼容的 `.hermes.md`）的 kos vault 根目录。
- 应先存在 `00_工作台/今日工作台.md`。
- AI 可以整理结构，但不能伪装成用户原始想法。

## How to Run

用户输入：

```text
/kos-end-my-day
```

## Quick Reference

1. 调用 `90_系统/harness/generate_diary.py`。
2. 在 `23_日记/YYYY/MM/YYYY-MM-DD.md` 生成或更新当天日记。
3. 保留 `<!-- 人手动添加 -->` 区块。
4. 运行 Harness。
5. 输出日记路径和需要人工填写的栏目。

## Procedure

### Step 1: 生成日记

```bash
python3 90_系统/harness/generate_diary.py
```

脚本会：

- 读取今日工作台。
- 生成当天 Diary。
- 写入今日任务快照、待审核内容、active 项目链接。
- 保留人工填写区。

### Step 2: 运行 Harness

```bash
python3 90_系统/harness/validate_paths.py
python3 90_系统/harness/validate_schema.py
python3 90_系统/harness/validate_state.py
python3 90_系统/harness/validate_permissions.py
python3 90_系统/harness/generate_health_report.py
```

## Pitfalls

- 不要把 AI 总结写成人的原始想法。
- 不要覆盖人工填写区。
- 不要自动创建 Reflection，除非用户明确要求。

## Verification

- Diary 位于 `23_日记/YYYY/MM/`。
- `type: diary`。
- 日期字段合法。
- 人工填写区被保留。
- Harness 全部通过。
