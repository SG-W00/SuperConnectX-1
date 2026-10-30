/**
 * 分屏搜索筛选用例
 * 覆盖多关键字（| 分隔）、大小写、正则与非法正则等边界
 */
import { describe, it, expect } from 'vitest'
import {
  buildSearchMatcher,
  filterLines,
  splitKeywords
} from '../../apps/superconnectx/src/renderer/src/features/diagnostics/searchFilter'

describe('splitKeywords', () => {
  it('按 | 拆分并去除空白与空项', () => {
    expect(splitKeywords('[qs] | QS |  |  event')).toEqual(['[qs]', 'QS', 'event'])
  })

  it('空输入返回空数组', () => {
    expect(splitKeywords('')).toEqual([])
    expect(splitKeywords(' | | ')).toEqual([])
  })
})

describe('buildSearchMatcher', () => {
  it('空输入不匹配任何行', () => {
    const matcher = buildSearchMatcher('')
    expect(matcher.empty).toBe(true)
    expect(matcher.test('any line')).toBe(false)
  })

  it('默认不区分大小写', () => {
    const matcher = buildSearchMatcher('[qs]')
    expect(matcher.test('14:24:57.108 [14141762][os]|[QS] session start')).toBe(true)
    expect(matcher.test('unrelated output')).toBe(false)
  })

  it('多个关键字命中任意一个即匹配（OR）', () => {
    const matcher = buildSearchMatcher('[qs]|QS|bat_drv')
    expect(matcher.test('line with [qs]')).toBe(true)
    expect(matcher.test('line with bat_drv')).toBe(true)
    expect(matcher.test('line without keywords')).toBe(false)
  })

  it('区分大小写时严格匹配', () => {
    const matcher = buildSearchMatcher('QS', { caseSensitive: true })
    expect(matcher.test('output QS')).toBe(true)
    expect(matcher.test('output qs')).toBe(false)
  })

  it('正则模式整条 pattern 作为 RegExp', () => {
    const matcher = buildSearchMatcher('^\\d{2}:\\d{2}:\\d{2}.*event', { regex: true })
    expect(matcher.error).toBeNull()
    expect(matcher.test('14:25:00.954 event 7')).toBe(true)
    expect(matcher.test('no timestamp event 7')).toBe(false)
  })

  it('正则模式支持 | 交替与大小写开关', () => {
    const insensitive = buildSearchMatcher('bat_sts|NTC ADC', { regex: true })
    expect(insensitive.test('ntc adc value')).toBe(true)

    const sensitive = buildSearchMatcher('bat_sts|NTC ADC', { regex: true, caseSensitive: true })
    expect(sensitive.test('ntc adc value')).toBe(false)
  })

  it('非法正则返回错误且不匹配', () => {
    const matcher = buildSearchMatcher('[unclosed', { regex: true })
    expect(matcher.error).toBeTruthy()
    expect(matcher.test('[unclosed')).toBe(false)
  })
})

describe('filterLines', () => {
  const lines = [
    '14:24:57.108 [14141762][os]|[QS] session start',
    '14:24:57.749 [14145676][os]|[I][341]: recorder_timer_func',
    '14:25:01.291 [14146218][bat_sts][I][1172]: CONFIG_OK'
  ]

  it('保留命中行的原始顺序', () => {
    const matcher = buildSearchMatcher('[qs]|bat_sts')
    expect(filterLines(lines, matcher)).toEqual([lines[0], lines[2]])
  })

  it('空匹配器返回空数组', () => {
    expect(filterLines(lines, buildSearchMatcher(''))).toEqual([])
  })

  it('正则错误时返回空数组', () => {
    expect(filterLines(lines, buildSearchMatcher('(', { regex: true }))).toEqual([])
  })
})
