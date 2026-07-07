# 微信读书阅读进度和统计同步流程

## 目标

把微信读书阅读进度和统计用于 kos Dashboard，不直接替代知识审核状态。

## 数据来源

- `/book/getprogress`：单本书阅读进度。
- `/readdata/detail`：本周、本月、本年、总计阅读统计。
- `/shelf/sync`：书架列表、公开/私密、最近阅读时间。

## 单本书进度

`/book/getprogress` 中的 `progress` 是 0-100 的整数百分比。

规则：

- `progress=0`：未开始或无有效进度。
- `progress=1`：1%，不是读完。
- `progress=100` 且有 `finishTime`：读完。
- 读完不等于已复盘，不得自动设置 Source `status: reviewed`。

## 阅读状态建议

第一版不扩展 Source frontmatter 状态机，阅读状态写在 Source 自动同步区：

```markdown
<!-- weread-sync:start -->
- reading_status: unread / reading / finished / paused
- progress: 45%
- current_chapter_uid:
- chapter_offset:
- record_reading_time_seconds:
- last_read_at:
- finish_time:
<!-- weread-sync:end -->
```

## 阅读统计

`/readdata/detail` 的时长字段单位均为秒。

展示规则：

- 秒转换为 `X小时Y分钟`。
- 时间戳转换为 `YYYY-MM-DD`。
- `dayAverageReadTime` 是自然日平均，不是阅读日平均。
- 跨周期统计必须按自然周/月/年拆分，不能把 `overall` 当成任意区间。

## Dashboard 建议

每日工作台可以增加：

- 当前在读书籍
- 读完但未复盘的书
- 有划线但未整理的书
- 本周阅读时长
- 本月阅读天数
- 待读书籍候选

这些指标用于提醒，不直接改变 Source / Extract / Summary 的审核状态。

## Harness

优先使用确定性脚本：

```bash
python3 90_系统/harness/sync_weread_progress.py "<书名、bookId 或 Source 路径>"
```

预览时使用：

```bash
python3 90_系统/harness/sync_weread_progress.py "<书名、bookId 或 Source 路径>" --dry-run
```

脚本会读取 `WEREAD_API_KEY` 或 `~/.config/kos/weread.env`，只更新 Source 中的 `weread-sync` 自动同步区。
