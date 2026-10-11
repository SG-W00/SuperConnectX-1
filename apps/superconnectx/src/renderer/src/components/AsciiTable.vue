<template>
  <div class="ascii-tab">
    <div class="ascii-toolbar">
      <SearchInput :placeholder="t('ascii.search')" class="ascii-search" @search="onSearch" />
      <el-select v-model="searchMode" class="ascii-select">
        <el-option
          v-for="opt in searchOptions"
          :key="opt.value"
          :label="opt.label"
          :value="opt.value"
        />
      </el-select>
    </div>
    <div class="ascii-table-wrap">
      <div class="ascii-table-head">
        <table class="ascii-table">
          <colgroup>
            <col v-for="col in columns" :key="col.key" :style="{ width: col.width || 'auto' }" />
          </colgroup>
          <thead>
            <tr>
              <th
                v-for="col in columns"
                :key="col.key"
                :class="{ sortable: col.sortable, active: sortKey === col.key }"
                @click="col.sortable && toggleSort(col.key)"
              >
                {{ col.label }}
                <span v-if="col.sortable" class="sort-ind">
                  {{ sortKey === col.key ? (sortAsc ? '▲' : '▼') : '⇅' }}
                </span>
              </th>
            </tr>
          </thead>
        </table>
      </div>
      <div class="ascii-table-body">
        <table class="ascii-table">
          <colgroup>
            <col v-for="col in columns" :key="col.key" :style="{ width: col.width || 'auto' }" />
          </colgroup>
          <tbody>
            <tr v-for="row in filtered" :key="row.decimal">
              <td>{{ row.decimal }}</td>
              <td class="ascii-glyph">{{ row.ascii || '·' }}</td>
              <td>{{ row.hex }}</td>
              <td>{{ row.bin }}</td>
              <td class="ascii-desc">{{ row.desc }}</td>
            </tr>
          </tbody>
        </table>
        <div v-if="filtered.length === 0" class="ascii-empty">
          {{ t('ascii.noResult') }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import SearchInput from './SearchInput.vue'

const { t } = useI18n()

const onSearch = (val: string) => {
  searchText.value = val
}

interface AsciiRow {
  decimal: number
  ascii: string
  hex: string
  bin: string
  desc: string
}

type SortKey = keyof AsciiRow

// 控制字符及空格的 ASCII 列缩写（说明文字走 i18n，见 ascii.desc.<十进制>）
const specialAscii: Record<number, string> = {
  0: 'NUL',
  1: 'SOH',
  2: 'STX',
  3: 'ETX',
  4: 'EOT',
  5: 'ENQ',
  6: 'ACK',
  7: 'BEL',
  8: 'BS',
  9: 'HT',
  10: 'LF',
  11: 'VT',
  12: 'FF',
  13: 'CR',
  14: 'SO',
  15: 'SI',
  16: 'DLE',
  17: 'DC1',
  18: 'DC2',
  19: 'DC3',
  20: 'DC4',
  21: 'NAK',
  22: 'SYN',
  23: 'ETB',
  24: 'CAN',
  25: 'EM',
  26: 'SUB',
  27: 'ESC',
  28: 'FS',
  29: 'GS',
  30: 'RS',
  31: 'US',
  32: 'SP',
  127: 'DEL'
}

// 取说明文字：优先 i18n，缺失时回退为空（可打印字符无说明）
// 注意：必须在 computed（filtered）内调用 t()，才能随语言切换实时更新
const getDesc = (decimal: number): string => {
  const key = `ascii.descMap.${decimal}`
  const val = t(key)
  return val === key ? '' : val
}

// 静态数据（不随语言变化）
interface AsciiBase {
  decimal: number
  ascii: string
  hex: string
  bin: string
}

const allAsciiBase: AsciiBase[] = []
for (let i = 0; i <= 127; i++) {
  const hex = i.toString(16).toUpperCase().padStart(2, '0')
  const bin = i.toString(2).padStart(8, '0')
  allAsciiBase.push({
    decimal: i,
    ascii: i in specialAscii ? specialAscii[i] : String.fromCharCode(i),
    hex,
    bin
  })
}

const columns = computed(() => [
  { key: 'decimal' as SortKey, label: t('ascii.decimal'), width: '90px', sortable: true },
  { key: 'ascii' as SortKey, label: t('ascii.ascii'), width: '90px', sortable: true },
  { key: 'hex' as SortKey, label: t('ascii.hex'), width: '90px', sortable: true },
  { key: 'bin' as SortKey, label: t('ascii.bin'), width: '130px', sortable: true },
  { key: 'desc' as SortKey, label: t('ascii.desc'), width: '', sortable: true }
])

const searchMode = ref<'all' | SortKey>('all')
const searchText = ref('')
const sortKey = ref<SortKey>('decimal')
const sortAsc = ref(true)

const searchOptions = computed(() => [
  { value: 'all', label: t('ascii.all') },
  { value: 'decimal', label: t('ascii.decimal') },
  { value: 'ascii', label: t('ascii.ascii') },
  { value: 'hex', label: t('ascii.hex') },
  { value: 'bin', label: t('ascii.bin') },
  { value: 'desc', label: t('ascii.desc') }
])

const toggleSort = (key: SortKey) => {
  if (sortKey.value === key) sortAsc.value = !sortAsc.value
  else {
    sortKey.value = key
    sortAsc.value = true
  }
}

const filtered = computed<AsciiRow[]>(() => {
  // 在 computed 内调用 t()，使其依赖当前语言，切换语言时说明文本实时更新
  const rows = allAsciiBase.map((r) => ({ ...r, desc: getDesc(r.decimal) }))
  const q = searchText.value.trim().toLowerCase()
  let list: AsciiRow[] = rows
  if (q) {
    switch (searchMode.value) {
      case 'decimal':
        list = rows.filter((r) => String(r.decimal).includes(q))
        break
      case 'ascii':
        list = rows.filter((r) => r.ascii.toLowerCase().includes(q))
        break
      case 'hex':
        list = rows.filter((r) => r.hex.toLowerCase().includes(q))
        break
      case 'bin':
        list = rows.filter((r) => r.bin.toLowerCase().includes(q))
        break
      case 'desc':
        list = rows.filter((r) => r.desc.toLowerCase().includes(q))
        break
      default:
        list = rows.filter(
          (r) =>
            String(r.decimal).includes(q) ||
            r.ascii.toLowerCase().includes(q) ||
            r.hex.toLowerCase().includes(q) ||
            r.bin.toLowerCase().includes(q) ||
            r.desc.toLowerCase().includes(q)
        )
    }
  }
  const key = sortKey.value
  const dir = sortAsc.value ? 1 : -1
  return [...list].sort((a, b) => {
    if (key === 'decimal') return (a.decimal - b.decimal) * dir
    return a[key].localeCompare(b[key]) * dir
  })
})
</script>

<style scoped>
.ascii-tab {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  padding: 14px 16px;
  box-sizing: border-box;
  background: var(--shortcuts-page-bg);
}
.ascii-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  flex-shrink: 0;
}
.ascii-select {
  width: 96px;
  flex-shrink: 0;
}
.ascii-search {
  flex: 1;
  margin-top: 0;
}
.ascii-search :deep(.sidebar-search) {
  margin-top: 0;
}
.ascii-table-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--shortcuts-table-border);
  border-radius: 4px;
}
.ascii-table-head {
  flex-shrink: 0;
  overflow: hidden;
  padding-right: 8px;
  background: var(--shortcuts-table-header-bg);
}
.ascii-table-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  scrollbar-gutter: stable;
}
.ascii-table-body::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
.ascii-table-body::-webkit-scrollbar-track {
  background: var(--shortcuts-table-bg);
}
.ascii-table-body::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb);
  border-radius: 4px;
}
.ascii-table-body::-webkit-scrollbar-thumb:hover {
  background: var(--scrollbar-thumb-hover);
}
.ascii-table {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  font-size: 13px;
  color: var(--shortcuts-table-text);
  background: var(--shortcuts-table-bg);
}
.ascii-table thead th {
  background: var(--shortcuts-table-header-bg);
  color: var(--shortcuts-table-text);
  font-weight: 600;
  text-align: left;
  padding: 8px 12px;
  border-bottom: 1px solid var(--shortcuts-table-header-border);
  white-space: nowrap;
  user-select: none;
}
.ascii-table thead th.sortable {
  cursor: pointer;
}
.ascii-table thead th.sortable:hover {
  background: var(--shortcuts-table-row-hover);
}
.ascii-table thead th.active {
  color: var(--el-color-primary);
}
.sort-ind {
  font-size: 11px;
  margin-left: 4px;
  opacity: 0.7;
}
.ascii-table tbody td {
  padding: 7px 12px;
  border-bottom: 1px solid var(--shortcuts-table-row-border);
  white-space: nowrap;
}
.ascii-table tbody tr:nth-child(even) {
  background: var(--shortcuts-table-stripe-bg);
}
.ascii-table tbody tr:hover > td {
  background: var(--shortcuts-table-row-hover);
}
.ascii-glyph {
  font-family: monospace;
  font-size: 15px;
  text-align: center;
}
.ascii-desc {
  white-space: normal;
}
.ascii-empty {
  padding: 30px 0;
  text-align: center;
  color: var(--shortcuts-table-empty);
  font-size: 13px;
}
</style>
