/**
 * 分屏搜索 — 行筛选匹配工具（纯函数，便于单元测试）
 *
 * 语法约定：
 * - 默认模式：多个关键字用 `|` 分隔，命中任意一个即匹配（OR），不区分大小写
 * - 正则模式：整条输入作为一条 RegExp，大小写开关决定是否加 `i`
 * - 空输入：不匹配任何行（右侧保持空白，而不是把所有行都刷出来）
 */

export interface SearchFilterOptions {
  /** 区分大小写，默认 false */
  caseSensitive?: boolean
  /** 是否按正则解析整条输入，默认 false */
  regex?: boolean
}

export interface SearchMatcher {
  /** 输入为空（此时 test 恒为 false） */
  empty: boolean
  /** 正则编译错误信息，正常为 null */
  error: string | null
  /** 判断单行是否命中 */
  test: (line: string) => boolean
}

/** 拆分 `|` 分隔的关键字，去除首尾空白与空项 */
export function splitKeywords(pattern: string): string[] {
  return (pattern ?? '')
    .split('|')
    .map((keyword) => keyword.trim())
    .filter((keyword) => keyword.length > 0)
}

/** 构造行匹配器；正则非法时返回 error 且 test 恒 false */
export function buildSearchMatcher(
  pattern: string,
  options: SearchFilterOptions = {}
): SearchMatcher {
  const raw = (pattern ?? '').trim()
  const caseSensitive = options.caseSensitive === true

  if (!raw) {
    return { empty: true, error: null, test: () => false }
  }

  if (options.regex === true) {
    try {
      const regExp = new RegExp(raw, caseSensitive ? '' : 'i')
      return { empty: false, error: null, test: (line: string) => regExp.test(line) }
    } catch (error) {
      return {
        empty: false,
        error: error instanceof Error ? error.message : String(error),
        test: () => false
      }
    }
  }

  const keywords = splitKeywords(raw).map((keyword) =>
    caseSensitive ? keyword : keyword.toLowerCase()
  )
  if (keywords.length === 0) {
    return { empty: true, error: null, test: () => false }
  }

  // 单关键字走 fast path，避免每行都创建小写副本
  if (keywords.length === 1) {
    const only = keywords[0]
    if (caseSensitive) {
      return { empty: false, error: null, test: (line: string) => line.includes(only) }
    }
    return {
      empty: false,
      error: null,
      test: (line: string) => line.toLowerCase().includes(only)
    }
  }

  return {
    empty: false,
    error: null,
    test: (line: string) => {
      const normalized = caseSensitive ? line : line.toLowerCase()
      return keywords.some((keyword) => normalized.includes(keyword))
    }
  }
}

/** 按匹配器过滤行数组（保留原顺序） */
export function filterLines(lines: readonly string[], matcher: SearchMatcher): string[] {
  if (matcher.empty || matcher.error) return []
  const result: string[] = []
  for (const line of lines) {
    if (matcher.test(line)) result.push(line)
  }
  return result
}
