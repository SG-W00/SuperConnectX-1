<template>
  <div class="terminal-search-split">
    <!-- 顶部筛选栏：输入框 + 命中统计 + 大小写/正则开关 + 清空/关闭 -->
    <div class="search-toolbar">
      <el-input
        v-model="pattern"
        size="small"
        clearable
        :placeholder="t('searchSplit.placeholder')"
        class="search-input"
        @input="scheduleRefilter"
        @blur="normalizePattern"
        @keydown.enter="normalizePattern"
        @keydown.esc.stop="handleEscape"
      />
      <!-- 历史表达式：保存过的筛选条件，点击填入、可单条删除或清空 -->
      <el-popover
        v-model:visible="historyVisible"
        placement="bottom-end"
        :width="280"
        trigger="click"
        popper-class="search-split-history-popper"
      >
        <template #reference>
          <button type="button" class="tool-btn" :class="{ active: historyVisible }">
            <el-icon :size="13"><Clock /></el-icon>
          </button>
        </template>
        <div class="history-panel">
          <div class="history-header">
            <span class="history-title">{{ t('searchSplit.history') }}</span>
            <button v-if="history.length > 0" type="button" class="history-clear" @click="clearHistory">
              {{ t('searchSplit.clearHistory') }}
            </button>
          </div>
          <div v-if="history.length === 0" class="history-empty">{{ t('searchSplit.noHistory') }}</div>
          <ul v-else class="history-list">
            <li v-for="item in history" :key="item" class="history-item">
              <button type="button" class="history-text" :title="item" @click="applyHistory(item)">
                {{ item }}
              </button>
              <button
                type="button"
                class="history-remove"
                :title="t('searchSplit.removeHistory')"
                @click="removeHistory(item)"
              >
                <el-icon :size="12"><Close /></el-icon>
              </button>
            </li>
          </ul>
        </div>
      </el-popover>
      <span class="search-count" :title="t('searchSplit.countTip')">{{ matchCount }} / {{ totalCount }}</span>
      <el-tooltip :content="t('searchSplit.caseSensitive')" placement="top" :show-after="TOOLTIP_SHOW_AFTER">
        <button
          type="button"
          class="tool-btn"
          :class="{ active: caseSensitive }"
          @click="toggleCaseSensitive"
        >
          Aa
        </button>
      </el-tooltip>
      <el-tooltip :content="t('searchSplit.regex')" placement="top" :show-after="TOOLTIP_SHOW_AFTER">
        <button type="button" class="tool-btn" :class="{ active: useRegex }" @click="toggleRegex">
          .*
        </button>
      </el-tooltip>
      <el-tooltip :content="t('searchSplit.clear')" placement="top" :show-after="TOOLTIP_SHOW_AFTER">
        <button type="button" class="tool-btn" @click="clearResult">
          <el-icon :size="13"><Delete /></el-icon>
        </button>
      </el-tooltip>
      <el-tooltip :content="t('searchSplit.close')" placement="top" :show-after="TOOLTIP_SHOW_AFTER">
        <button type="button" class="tool-btn" @click="emit('close')">
          <el-icon :size="13"><Close /></el-icon>
        </button>
      </el-tooltip>
    </div>

    <!-- 结果输出区（Monaco 只读） + 空状态提示 -->
    <div class="search-output-area">
      <div ref="editorContainer" class="search-output"></div>
      <div v-if="hintText" class="search-hint" :class="{ error: !!regexError }">{{ hintText }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 分屏搜索 — 右半区筛选结果面板
 *
 * 职责：
 * 1. 接收 ComTerminal 分发的输出块（与左侧同一份文本），按行筛选后追加到只读 Monaco
 * 2. 支持多关键字（`|` 分隔，OR）、区分大小写、整条正则三种匹配方式
 * 3. 关键词变化时对已缓存源行重新过滤（防抖 250ms）
 *
 * 性能约束：
 * - 源行最多保留 MAX_SOURCE_LINES 行、结果最多保留 MAX_RESULT_LINES 行，超出丢弃最旧内容
 * - 追加走定时批量 applyEdits（APPEND_FLUSH_MS），避免每行一次编辑操作
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import * as monaco from 'monaco-editor'
import { Delete, Close, Clock } from '@element-plus/icons-vue'
import { parseAnsiToSegments } from '../../utils/AnsiParser'
import { getMonacoTheme } from '../../utils/MonacoTheme'
import { TOOLTIP_SHOW_AFTER } from '../../utils/constants'
import { buildSearchMatcher, type SearchMatcher } from '../diagnostics/searchFilter'

const props = withDefaults(
  defineProps<{
    /** 终端字体大小（与左侧终端保持一致） */
    fontSize?: number
    /** 终端字体系列（与左侧终端保持一致） */
    fontFamily?: string
    /** 是否显示行号（跟随左侧终端设置） */
    lineNumbers?: boolean
  }>(),
  {
    fontSize: 14,
    fontFamily: '',
    lineNumbers: true
  }
)

const emit = defineEmits<{
  close: []
}>()

const { t } = useI18n()

/** 源行保留上限（约等于长连接数小时的输出行数） */
const MAX_SOURCE_LINES = 200_000
/** 结果保留上限 */
const MAX_RESULT_LINES = 50_000
/** 未完成行（无换行结尾）静默多久后按一行处理 */
const PENDING_FLUSH_MS = 500
/** 关键词输入防抖 */
const REFILTER_DEBOUNCE_MS = 250
/** 追加批量刷新间隔 */
const APPEND_FLUSH_MS = 40

/** 本地持久化键：历史表达式列表 / 匹配选项 */
const LAST_CASE_KEY = 'scx.searchSplit.caseSensitive'
const LAST_REGEX_KEY = 'scx.searchSplit.useRegex'
const HISTORY_KEY = 'scx.searchSplit.history'
/** 历史条数上限 */
const HISTORY_LIMIT = 20

const readHistory = (): string[] => {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string').slice(0, HISTORY_LIMIT)
  } catch {
    return []
  }
}

const readFlag = (key: string): boolean => {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

const writeFlag = (key: string, value: boolean): void => {
  try {
    localStorage.setItem(key, value ? '1' : '0')
  } catch {
    // 忽略写入失败
  }
}

// 打开分屏时输入框保持为空（不自动套用上次条件、不还原历史日志）；
// 匹配选项（Aa / .*）仍然记忆，历史表达式可通过下拉选择
const pattern = ref('')
const history = ref<string[]>(readHistory())
const historyVisible = ref(false)
const caseSensitive = ref(readFlag(LAST_CASE_KEY))
const useRegex = ref(readFlag(LAST_REGEX_KEY))
const matchCount = ref(0)
const totalCount = ref(0)
const regexError = ref('')
const isAutoScroll = ref(true)

const editorContainer = ref<HTMLElement | null>(null)
let editor: monaco.editor.IStandaloneCodeEditor | null = null
let editorModel: monaco.editor.ITextModel | null = null
let themeObserver: MutationObserver | null = null

/** 已接收的全部源行（用于重新过滤） */
const sourceLines: string[] = []
/** 累计接收行数（不受源行裁剪影响，用于工具栏计数） */
let receivedTotal = 0
/** 尚未遇到换行的残行 */
let pendingText = ''
/** 待追加到结果区的命中行 */
const queuedResultLines: string[] = []
let matcher: SearchMatcher = buildSearchMatcher('')

let pendingTimer: ReturnType<typeof setTimeout> | null = null
let refilterTimer: ReturnType<typeof setTimeout> | null = null
let appendTimer: ReturnType<typeof setTimeout> | null = null

const hintText = computed(() => {
  if (regexError.value) return regexError.value
  if (!pattern.value.trim()) return t('searchSplit.emptyHint')
  if (matchCount.value === 0) return t('searchSplit.noMatch')
  return ''
})

const clearTimers = (): void => {
  if (pendingTimer) {
    clearTimeout(pendingTimer)
    pendingTimer = null
  }
  if (refilterTimer) {
    clearTimeout(refilterTimer)
    refilterTimer = null
  }
  if (appendTimer) {
    clearTimeout(appendTimer)
    appendTimer = null
  }
}

/** 滚动到底部 */
const scrollToEnd = (): void => {
  if (!editor) return
  editor.setScrollTop(editor.getScrollHeight())
}

/** 结果区整体替换 */
const setResultText = (text: string): void => {
  if (!editorModel) return
  editorModel.setValue(text)
  isAutoScroll.value = true
  scrollToEnd()
}

/** 结果超过上限时只保留末尾 MAX_RESULT_LINES 行 */
const truncateResultIfNeeded = (): void => {
  if (!editorModel) return
  const lineCount = editorModel.getLineCount()
  if (lineCount - 1 <= MAX_RESULT_LINES) return
  const startLine = Math.max(1, lineCount - MAX_RESULT_LINES)
  const text = editorModel.getValueInRange({
    startLineNumber: startLine,
    startColumn: 1,
    endLineNumber: lineCount,
    endColumn: editorModel.getLineMaxColumn(lineCount)
  })
  editorModel.setValue(text)
}

/** 批量把命中行追加到结果区末尾 */
const flushQueuedLines = (): void => {
  appendTimer = null
  if (!editorModel || queuedResultLines.length === 0) return

  const text = `${queuedResultLines.join('\n')}\n`
  queuedResultLines.length = 0

  const lastLine = editorModel.getLineCount()
  const lastColumn = editorModel.getLineMaxColumn(lastLine)
  editorModel.applyEdits([
    {
      range: new monaco.Range(lastLine, lastColumn, lastLine, lastColumn),
      text,
      forceMoveMarkers: false
    }
  ])

  truncateResultIfNeeded()
  if (isAutoScroll.value) scrollToEnd()
}

const scheduleFlush = (): void => {
  if (appendTimer) return
  appendTimer = setTimeout(flushQueuedLines, APPEND_FLUSH_MS)
}

/** 处理一行源文本：入缓存 + 命中则入结果队列 */
const handleSourceLine = (line: string): void => {
  sourceLines.push(line)
  // 超限时一次性丢弃最旧的 1/10，避免每行都触发 O(n) 的数组搬移
  if (sourceLines.length > MAX_SOURCE_LINES) {
    sourceLines.splice(0, Math.max(1, Math.floor(MAX_SOURCE_LINES / 10)))
  }
  receivedTotal++
  totalCount.value = receivedTotal

  if (matcher.empty || matcher.error) return
  if (!matcher.test(line)) return

  queuedResultLines.push(line)
  matchCount.value++
  scheduleFlush()
}

/** 对已缓存源行全量重新过滤 */
const refilter = (): void => {
  refilterTimer = null
  matcher = buildSearchMatcher(pattern.value, {
    caseSensitive: caseSensitive.value,
    regex: useRegex.value
  })
  regexError.value = matcher.error ?? ''

  const matched: string[] = []
  for (const line of sourceLines) {
    if (matcher.test(line)) matched.push(line)
  }

  const tail = matched.length > MAX_RESULT_LINES ? matched.slice(matched.length - MAX_RESULT_LINES) : matched
  matchCount.value = matched.length
  queuedResultLines.length = 0
  setResultText(tail.length > 0 ? `${tail.join('\n')}\n` : '')
}

const scheduleRefilter = (): void => {
  if (refilterTimer) clearTimeout(refilterTimer)
  refilterTimer = setTimeout(refilter, REFILTER_DEBOUNCE_MS)
}

/** 记录本次表达式到历史（去重、最近优先） */
const saveToHistory = (value: string): void => {
  const text = value.trim()
  if (!text) return
  if (history.value[0] === text) return
  const next = [text, ...history.value.filter((item) => item !== text)].slice(0, HISTORY_LIMIT)
  history.value = next
  persistHistory()
}

const persistHistory = (): void => {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.value))
  } catch {
    // 忽略写入失败
  }
}

/**
 * 失焦/回车时把 `[qs]|QS` 规范成 `[qs] | QS`，`|` 两侧留出空隙便于阅读
 * 仅在非输入过程中改写，避免边打字边改导致光标跳动；匹配结果不受影响（解析时本就 trim）
 */
const normalizePattern = (): void => {
  const parts = pattern.value
    .split('|')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
  const normalized = parts.join(' | ')
  if (normalized !== pattern.value) {
    pattern.value = normalized
    scheduleRefilter()
  }
  saveToHistory(normalized)
}

/** Esc 关闭前先保存当前表达式 */
const handleEscape = (): void => {
  normalizePattern()
  emit('close')
}

/** 从历史中选择一条 */
const applyHistory = (item: string): void => {
  pattern.value = item
  historyVisible.value = false
  refilter()
}

/** 删除单条历史 */
const removeHistory = (item: string): void => {
  history.value = history.value.filter((entry) => entry !== item)
  persistHistory()
}

/** 清空全部历史 */
const clearHistory = (): void => {
  history.value = []
  persistHistory()
}

const toggleCaseSensitive = (): void => {
  caseSensitive.value = !caseSensitive.value
  writeFlag(LAST_CASE_KEY, caseSensitive.value)
  scheduleRefilter()
}

const toggleRegex = (): void => {
  useRegex.value = !useRegex.value
  writeFlag(LAST_REGEX_KEY, useRegex.value)
  scheduleRefilter()
}

/** 清空右侧显示（源行保留，改关键词仍可重新筛出） */
const clearResult = (): void => {
  queuedResultLines.length = 0
  matchCount.value = 0
  setResultText('')
}

/** 左侧清空时同步清空源与结果 */
const clearAll = (): void => {
  clearTimers()
  sourceLines.length = 0
  queuedResultLines.length = 0
  pendingText = ''
  receivedTotal = 0
  matchCount.value = 0
  totalCount.value = 0
  setResultText('')
}

/**
 * 接收输出块（与左侧终端同一份文本）
 * 按 \n 切行，末尾残行留待下一块拼接；长时间无后续数据则按一行兜底处理
 */
const appendChunk = (chunk: string): void => {
  if (!chunk) return
  // 剥离 ANSI 转义序列，保证与左侧显示文本口径一致
  const { cleanText } = parseAnsiToSegments(chunk)
  if (!cleanText) return

  pendingText += cleanText
  const parts = pendingText.split('\n')
  pendingText = parts.pop() ?? ''
  for (const line of parts) handleSourceLine(line)

  if (pendingTimer) {
    clearTimeout(pendingTimer)
    pendingTimer = null
  }
  if (pendingText) {
    pendingTimer = setTimeout(() => {
      const rest = pendingText
      pendingText = ''
      pendingTimer = null
      handleSourceLine(rest)
    }, PENDING_FLUSH_MS)
  }
}

/** 回填左侧已有内容（开启分屏时调用；只取尾部 2MB，避免正文过长卡顿） */
const setSource = (text: string): void => {
  clearAll()
  if (!text) {
    refilter()
    return
  }

  const MAX_BACKFILL_CHARS = 2 * 1024 * 1024
  const { cleanText } = parseAnsiToSegments(text)
  let source = cleanText
  if (source.length > MAX_BACKFILL_CHARS) {
    source = source.slice(source.length - MAX_BACKFILL_CHARS)
    const firstBreak = source.indexOf('\n')
    if (firstBreak > 0) source = source.slice(firstBreak + 1)
  }

  const lines = source.split('\n')
  // 末行可能是不完整行，先放入 pending，后续数据到达时拼接
  pendingText = lines.pop() ?? ''
  for (const line of lines) sourceLines.push(line)
  if (sourceLines.length > MAX_SOURCE_LINES) {
    sourceLines.splice(0, sourceLines.length - MAX_SOURCE_LINES)
  }
  receivedTotal = sourceLines.length
  totalCount.value = receivedTotal

  // 先按当前关键词筛一遍，再把残行按一行处理
  refilter()
  if (pendingText) {
    const rest = pendingText
    pendingText = ''
    handleSourceLine(rest)
  }
}

const initEditor = (): void => {
  if (!editorContainer.value) return

  // 独立 URI，避免与左侧终端 model 冲突
  const uniqueUri = monaco.Uri.parse(
    `scx-search:///result-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`
  )
  editorModel = monaco.editor.createModel('', 'plaintext', uniqueUri)
  editor = monaco.editor.create(editorContainer.value, {
    model: editorModel,
    readOnly: true,
    // 行号跟随左侧终端；结果区强制自动换行，保证超长日志在窄栏下也能完整显示
    lineNumbers: props.lineNumbers ? 'on' : 'off',
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    theme: getMonacoTheme(),
    automaticLayout: true,
    hover: { enabled: false },
    occurrencesHighlight: 'off',
    selectionHighlight: false,
    codeLens: false,
    links: false,
    wordWrap: 'on',
    // 续行顶格，与日志阅读习惯一致（不按首行缩进对齐）
    wrappingIndent: 'none',
    wrappingStrategy: 'simple',
    fontSize: props.fontSize,
    // 行距放宽到 1.6 倍，日志逐行阅读更舒展
    lineHeight: Math.round(props.fontSize * 1.6),
    fontFamily: props.fontFamily || undefined,
    padding: { top: 6, bottom: 6 }
  })

  // 用户上滚时暂停自动跟随，滚回底部后恢复
  editor.onDidScrollChange(() => {
    if (!editor) return
    const distance =
      editor.getScrollHeight() - editor.getScrollTop() - editor.getLayoutInfo().height
    isAutoScroll.value = distance < 8
  })

  // 兜底：编辑器创建前已收到源行（如开启分屏瞬间的 setSource）时补一次过滤
  if (sourceLines.length > 0) refilter()
}

watch(
  () => props.fontSize,
  (value) => {
    if (!editor) return
    // 字号变化时行高同步放大，保持 1.6 倍行距
    editor.updateOptions({ fontSize: value, lineHeight: Math.round(value * 1.6) })
  }
)

watch(
  () => props.fontFamily,
  (value) => {
    if (!editor) return
    editor.updateOptions({ fontFamily: value || undefined })
  }
)

watch(
  () => props.lineNumbers,
  (value) => {
    editor?.updateOptions({ lineNumbers: value ? 'on' : 'off' })
  }
)

onMounted(() => {
  initEditor()

  // 跟随应用深浅主题切换
  themeObserver = new MutationObserver(() => {
    monaco.editor.setTheme(getMonacoTheme())
  })
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
})

onBeforeUnmount(() => {
  clearTimers()
  themeObserver?.disconnect()
  themeObserver = null
  editor?.dispose()
  editor = null
  editorModel?.dispose()
  editorModel = null
})

defineExpose({
  appendChunk,
  setSource,
  clearAll,
  clearResult,
  setWordWrap: (value: boolean) => {
    editor?.updateOptions({ wordWrap: value ? 'on' : 'off' })
  }
})
</script>

<style scoped>
.terminal-search-split {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  /* 背景与左侧终端输出区一致，视觉上就是同一窗口的另一半 */
  background: var(--terminal-output-bg, #1e1e1e);
  color: var(--com-terminal-color, #d4d4d4);
  overflow: hidden;
}

.search-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  /* 上下留白拉开一些，避免控件贴着边框显得局促 */
  padding: 8px 10px;
  border-bottom: 1px solid var(--com-param-row-border, #3a3a3a);
  flex-shrink: 0;
}

.search-input {
  flex: 1 1 auto;
  min-width: 80px;
}

/* 输入框放大到 30px 高，左右内边距加大，输入的文字不贴边框 */
.search-input :deep(.el-input__wrapper) {
  min-height: 30px;
  padding: 1px 12px;
  border-radius: 4px;
}

.search-input :deep(.el-input__inner) {
  height: 28px;
  line-height: 28px;
  font-size: 12px;
}

.search-count {
  flex-shrink: 0;
  padding: 0 4px;
  font-size: 11px;
  color: var(--com-param-label, #9aa4ad);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.tool-btn {
  flex-shrink: 0;
  height: 26px;
  min-width: 26px;
  padding: 0 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  line-height: 1;
  color: var(--com-param-label, #9aa4ad);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.tool-btn:hover {
  color: var(--menu-item-hover-color, #fff);
  background: var(--menu-item-hover-bg, #094771);
}

.tool-btn.active {
  color: var(--menu-item-hover-color, #fff);
  background: var(--menu-item-hover-bg, #094771);
  border-color: var(--menu-border-color, #3a3a3a);
}

/* 历史表达式下拉面板 */
.history-panel {
  display: flex;
  flex-direction: column;
}

.history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--menu-border-color, #3a3a3a);
}

.history-title {
  font-size: 12px;
  color: var(--text-tertiary, #ccc);
}

.history-clear {
  padding: 0;
  font-size: 11px;
  color: #409eff;
  background: none;
  border: none;
  cursor: pointer;
}

.history-clear:hover {
  text-decoration: underline;
}

.history-empty {
  padding: 14px 0;
  font-size: 12px;
  color: var(--text-tertiary, #ccc);
  text-align: center;
}

.history-list {
  max-height: 210px;
  margin: 4px 0 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}

.history-item {
  display: flex;
  align-items: center;
  gap: 4px;
  border-radius: 4px;
}

/* 悬停高亮使用应用自己的菜单变量，避免走到 Element Plus 浅色变量导致白底 */
.history-item:hover {
  background: var(--menu-item-hover-bg, #094771);
}

.history-text {
  flex: 1 1 auto;
  min-width: 0;
  padding: 6px 8px;
  overflow: hidden;
  font-family: var(--com-terminal-font, 'Consolas', monospace);
  font-size: 12px;
  /* 用应用文本色，保证不悬停时也能看清 */
  color: var(--text-primary, #e8e8e8);
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: none;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.history-item:hover .history-text {
  color: var(--menu-item-hover-color, #fff);
}

.history-remove {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin-right: 4px;
  color: var(--text-tertiary, #ccc);
  background: none;
  border: none;
  border-radius: 3px;
  cursor: pointer;
  opacity: 0.8;
}

.history-remove:hover {
  color: var(--text-white, #fff);
  background: var(--overlay-btn-hover, rgba(128, 128, 128, 0.2));
  opacity: 1;
}

.search-output-area {
  position: relative;
  /* basis 取 0，避免结果区高度被 Monaco 内容反向撑开 */
  flex: 1 1 0;
  min-height: 0;
}

.search-output {
  position: absolute;
  inset: 0;
}

.search-hint {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  padding: 0 12px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--com-param-label, #9aa4ad);
  text-align: center;
  pointer-events: none;
  /* 窄栏下允许换行，避免提示被截断 */
  white-space: normal;
  max-width: 90%;
}

.search-hint.error {
  color: var(--menu-danger-color, #f56c6c);
  white-space: normal;
}
</style>

<style>
/* el-popover 浮层会被挂到 body 上，需用非 scoped 样式适配应用深浅主题 */
.search-split-history-popper.el-popover.el-popper {
  background: var(--menu-bg-color, #2d2d2d);
  border-color: var(--menu-border-color, #3a3a3a);
  color: var(--text-primary, #e8e8e8);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
}

.search-split-history-popper .el-popper__arrow::before {
  background: var(--menu-bg-color, #2d2d2d);
  border-color: var(--menu-border-color, #3a3a3a);
}
</style>
