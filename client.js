/* eslint-disable no-undef */
/**
 * dsh-minimax-token-plan — browser half.
 *
 * Renders a MiniMax Token Plan indicator inside the DeepSeek Harness composer
 * dock (between the "token 用量" pill and the "上下文已用" ring):
 *
 *   - the pill shows the configured metric (5-hour remaining by default),
 *   - clicking it opens a panel with the 5-hour and weekly windows, per-model
 *     detail and the settings (API key / region / default metric / interval),
 *   - the API key is encrypted with a non-extractable AES-256-GCM key and kept
 *     in IndexedDB, never in the plugin configuration and never in a log,
 *   - requests only ever go to the official MiniMax hosts.
 *
 * The file is a classic script: it registers a factory for the browser module
 * table and must not use ESM `import` statements.
 */
window.__ModuleLoader__.load({
  id: 'dsh-minimax-token-plan',
  factory(require) {
    'use strict'

    const React = require('react')
    const ReactDOM = require('react-dom')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } = React
    const createPortal = ReactDOM.createPortal

    const NS = 'minimaxTokenPlan'
    const SLOT_ID = 'minimax-token-plan'

    /* ------------------------------------------------------------------ *
     * Constants
     * ------------------------------------------------------------------ */

    const REGION_BASE = {
      global: 'https://api.minimax.io',
      cn: 'https://api.minimax.cn',
    }
    const QUOTA_PATH = '/v1/token_plan/remains'

    const DB_NAME = 'dsh-minimax-token-plan'
    const DB_VERSION = 1
    const DB_STORE = 'kv'
    const DB_KEY_PREFS = 'prefs'
    const DB_KEY_SECRET = 'apiKey'
    const DB_KEY_DATA_KEY = 'dataKey'

    const METRIC_IDS = ['interval', 'weekly', 'lowestAbsolute', 'lowestPercent']
    const DEFAULT_PREFS = { metric: 'interval', region: 'auto', refreshMinutes: 5 }
    const TICK_MS = 30000
    const HOUR_MS = 3600000
    const FIVE_HOURS_MIN_MS = 4.5 * HOUR_MS
    const FIVE_HOURS_MAX_MS = 5.5 * HOUR_MS
    // A boosted weekly window can read far above 100 %. The clamp stays well
    // above anything the API can report so a boosted reading is never shown as
    // a round number it is not.
    const MAX_DISPLAY_PCT = 1000

    /* ------------------------------------------------------------------ *
     * Dictionaries
     * ------------------------------------------------------------------ */

    const ZH = {
      'pill.unconfigured': '未配置',
      'pill.loading': '查询中',
      'pill.error': '查询失败',
      'pill.idle': '—',
      'pill.warn': '⚠',
      'pill.tip.ready': 'MiniMax {metric}：{value}',
      'pill.tip.unconfigured': '尚未配置 MiniMax API Key，点击打开设置',
      'pill.tip.loading': '正在查询 MiniMax 套餐用量…',
      'pill.tip.error': '查询 MiniMax 套餐用量失败：{message}',
      'pill.tip.none': 'MiniMax 套餐用量：暂无数据',
      'panel.title': 'MiniMax Token Plan',
      'panel.interval': '5 小时剩余',
      'panel.weekly': '周剩余',
      'panel.displayed': '当前显示',
      'panel.intervalReset': '5 小时重置',
      'panel.weeklyReset': '周重置',
      'panel.updatedAt': '更新于',
      'panel.models': '模型明细',
      'panel.model': '模型',
      'panel.noAbsolute': '该套餐未提供绝对 token 数',
      'panel.unlimited': '无限',
      'panel.exhausted': '已用尽',
      'panel.boostNote': '含 {factor}× 加成（基础 {base}）',
      'panel.boostInline': '含 {factor}× 加成',
      'panel.noData': '暂无数据',
      'panel.refresh': '刷新',
      'panel.settings': '设置',
      'settings.apiKey': 'API Key',
      'settings.apiKeyHint': 'MiniMax M Plan Key（sk-cp- 开头），仅保存在本机。',
      'settings.apiKeyPlaceholder': 'sk-cp-…',
      'settings.save': '保存',
      'settings.saving': '保存中',
      'settings.clear': '清除',
      'settings.saved': '已加密保存',
      'settings.cleared': '已清除',
      'settings.error.empty': '请输入 API Key',
      'settings.error.failed': '保存失败：{message}',
      'settings.error.clearFailed': '清除失败：{message}',
      'settings.error.crypto': '当前环境不支持 WebCrypto，无法加密保存密钥',
      'settings.error.request': '无法访问 MiniMax 套餐用量接口',
      'settings.error.vault': '本机加密存储不可用',
      'settings.error.interval': '刷新间隔需在 1–60 分钟之间',
      'settings.refreshHint': '取值范围 1–60 分钟',
      'settings.region': '服务区域',
      'settings.region.auto': '自动检测',
      'settings.region.global': '国际 api.minimax.io',
      'settings.region.cn': '中国 api.minimax.cn',
      'settings.metric': '默认显示',
      'settings.refreshMinutes': '刷新间隔（分钟）',
      'settings.security': 'API Key 使用 AES-256-GCM 加密后保存在本机 IndexedDB，密钥不可导出；请求只发往 MiniMax 官方域名。',
      'settings.keyPresent': '已保存 API Key（已加密）',
      'settings.keyMissing': '尚未保存 API Key',
      'metric.interval': '5 小时剩余',
      'metric.weekly': '周剩余',
      'metric.lowestAbsolute': '绝对 token 最低',
      'metric.lowestPercent': '百分比最低',
    }

    const EN = {
      'pill.unconfigured': 'Not set',
      'pill.loading': 'Loading',
      'pill.error': 'Failed',
      'pill.idle': '—',
      'pill.warn': '⚠',
      'pill.tip.ready': 'MiniMax {metric}: {value}',
      'pill.tip.unconfigured': 'No MiniMax API key yet — click to open settings',
      'pill.tip.loading': 'Querying MiniMax plan usage…',
      'pill.tip.error': 'Could not query MiniMax plan usage: {message}',
      'pill.tip.none': 'MiniMax plan usage: no data',
      'panel.title': 'MiniMax Token Plan',
      'panel.interval': '5-hour remaining',
      'panel.weekly': 'Weekly remaining',
      'panel.displayed': 'Showing',
      'panel.intervalReset': '5-hour reset',
      'panel.weeklyReset': 'Weekly reset',
      'panel.updatedAt': 'Updated at',
      'panel.models': 'Models',
      'panel.model': 'Model',
      'panel.noAbsolute': 'This plan reports no absolute token counts',
      'panel.unlimited': 'Unlimited',
      'panel.exhausted': 'Exhausted',
      'panel.boostNote': '{factor}× boost included (base {base})',
      'panel.boostInline': '{factor}× boost',
      'panel.noData': 'No data',
      'panel.refresh': 'Refresh',
      'panel.settings': 'Settings',
      'settings.apiKey': 'API key',
      'settings.apiKeyHint': 'MiniMax M Plan key (starts with sk-cp-), stored on this machine only.',
      'settings.apiKeyPlaceholder': 'sk-cp-…',
      'settings.save': 'Save',
      'settings.saving': 'Saving',
      'settings.clear': 'Clear',
      'settings.saved': 'Encrypted and saved',
      'settings.cleared': 'Cleared',
      'settings.error.empty': 'Please enter an API key',
      'settings.error.failed': 'Could not save: {message}',
      'settings.error.clearFailed': 'Could not clear the key: {message}',
      'settings.error.crypto': 'WebCrypto is unavailable here, so the key cannot be stored encrypted',
      'settings.error.request': 'Could not reach the MiniMax plan usage endpoint',
      'settings.error.vault': 'The local encrypted store is unavailable',
      'settings.error.interval': 'The refresh interval must be between 1 and 60 minutes',
      'settings.refreshHint': 'Choose a value between 1 and 60 minutes',
      'settings.region': 'Service region',
      'settings.region.auto': 'Detect automatically',
      'settings.region.global': 'Global api.minimax.io',
      'settings.region.cn': 'China api.minimax.cn',
      'settings.metric': 'Default metric',
      'settings.refreshMinutes': 'Refresh interval (minutes)',
      'settings.security': 'The API key is encrypted with AES-256-GCM and stored in the local IndexedDB; the key itself is non-extractable. Requests only reach the official MiniMax hosts.',
      'settings.keyPresent': 'API key saved (encrypted)',
      'settings.keyMissing': 'No API key saved yet',
      'metric.interval': '5-hour remaining',
      'metric.weekly': 'Weekly remaining',
      'metric.lowestAbsolute': 'Lowest absolute tokens',
      'metric.lowestPercent': 'Lowest percentage',
    }

    /* ------------------------------------------------------------------ *
     * Small helpers
     * ------------------------------------------------------------------ */

    function messageOf(error, fallback) {
      if (!error) return fallback || '—'
      if (typeof error === 'string') return error
      if (error.message) return String(error.message)
      return String(error)
    }

    /**
     * A stable code for local-storage failures. The message is kept for the
     * console, the user only ever sees the localized text.
     */
    function vaultError(detail) {
      const error = new Error('VAULT_UNAVAILABLE')
      if (detail) error.cause = detail
      return error
    }

    function clampPct(value) {
      if (!Number.isFinite(value)) return null
      return Math.max(0, Math.min(MAX_DISPLAY_PCT, Math.round(value)))
    }

    function numberOrNull(value) {
      return typeof value === 'number' && Number.isFinite(value) ? value : null
    }

    function formatCount(value) {
      if (value === null || value === undefined || !Number.isFinite(value)) return '—'
      return Math.round(value).toLocaleString()
    }

    function formatClock(timestamp) {
      if (!timestamp) return '—'
      try {
        return new Date(timestamp).toLocaleTimeString()
      } catch (error) {
        return '—'
      }
    }

    /**
     * An absolute date and time in the reader's own time zone, e.g.
     * "Nov 21, 14:20" or "11月21日 14:20". The year is added when the moment
     * falls into another year, so a weekly window that ends next year stays
     * unambiguous.
     */
    function formatDateTime(timestamp) {
      if (timestamp === null || timestamp === undefined || !Number.isFinite(timestamp)) return '—'
      const date = new Date(timestamp)
      if (Number.isNaN(date.getTime())) return '—'
      try {
        const sameYear = date.getFullYear() === new Date().getFullYear()
        const options = {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }
        if (!sameYear) options.year = 'numeric'
        return new Intl.DateTimeFormat(undefined, options).format(date)
      } catch (error) {
        return date.toISOString().slice(0, 16).replace('T', ' ')
      }
    }

    function toBase64(buffer) {
      const bytes = new Uint8Array(buffer)
      let binary = ''
      for (let index = 0; index < bytes.length; index += 1) {
        binary += String.fromCharCode(bytes[index])
      }
      return btoa(binary)
    }

    function fromBase64(text) {
      const binary = atob(text)
      const bytes = new Uint8Array(binary.length)
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index)
      }
      return bytes
    }

    /* ------------------------------------------------------------------ *
     * IndexedDB vault
     * ------------------------------------------------------------------ */

    function openDatabase() {
      return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
          reject(vaultError('indexedDB missing'))
          return
        }
        const request = indexedDB.open(DB_NAME, DB_VERSION)
        request.onupgradeneeded = () => {
          const database = request.result
          if (!database.objectStoreNames.contains(DB_STORE)) {
            database.createObjectStore(DB_STORE)
          }
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(vaultError(request.error || 'open failed'))
      })
    }

    function databaseGet(database, key) {
      return new Promise((resolve, reject) => {
        const request = database.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(key)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(vaultError(request.error || 'read failed'))
      })
    }

    function databasePut(database, key, value) {
      return new Promise((resolve, reject) => {
        const transaction = database.transaction(DB_STORE, 'readwrite')
        transaction.objectStore(DB_STORE).put(value, key)
        transaction.oncomplete = () => resolve(undefined)
        transaction.onerror = () => reject(vaultError(transaction.error || 'write failed'))
      })
    }

    function databaseDelete(database, key) {
      return new Promise((resolve, reject) => {
        const transaction = database.transaction(DB_STORE, 'readwrite')
        transaction.objectStore(DB_STORE).delete(key)
        transaction.oncomplete = () => resolve(undefined)
        transaction.onerror = () => reject(vaultError(transaction.error || 'delete failed'))
      })
    }

    function cryptoAvailable() {
      return typeof crypto !== 'undefined' && !!crypto.subtle && typeof crypto.getRandomValues === 'function'
    }

    /** The data key is generated once, never extractable, and never leaves IndexedDB. */
    async function loadDataKey(database) {
      let key = await databaseGet(database, DB_KEY_DATA_KEY)
      if (!key) {
        key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
        await databasePut(database, DB_KEY_DATA_KEY, key)
      }
      return key
    }

    async function encryptSecret(plain) {
      if (!cryptoAvailable()) throw new Error('WEB_CRYPTO_UNAVAILABLE')
      const database = await openDatabase()
      try {
        const key = await loadDataKey(database)
        const iv = crypto.getRandomValues(new Uint8Array(12))
        const cipher = await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv },
          key,
          new TextEncoder().encode(plain),
        )
        await databasePut(database, DB_KEY_SECRET, { v: 1, iv: toBase64(iv), data: toBase64(cipher) })
      } finally {
        database.close()
      }
    }

    async function decryptSecret() {
      const database = await openDatabase()
      try {
        const blob = await databaseGet(database, DB_KEY_SECRET)
        if (!blob || !blob.iv || !blob.data) return null
        const key = await loadDataKey(database)
        const plain = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: fromBase64(blob.iv) },
          key,
          fromBase64(blob.data),
        )
        return new TextDecoder().decode(plain)
      } finally {
        database.close()
      }
    }

    async function clearSecret() {
      const database = await openDatabase()
      try {
        await databaseDelete(database, DB_KEY_SECRET)
      } finally {
        database.close()
      }
    }

    async function readPrefs() {
      const database = await openDatabase()
      try {
        const prefs = await databaseGet(database, DB_KEY_PREFS)
        return prefs && typeof prefs === 'object' ? prefs : null
      } finally {
        database.close()
      }
    }

    async function writePrefs(prefs) {
      const database = await openDatabase()
      try {
        await databasePut(database, DB_KEY_PREFS, prefs)
      } finally {
        database.close()
      }
    }

    /* ------------------------------------------------------------------ *
     * MiniMax quota API
     * ------------------------------------------------------------------ */

    /**
     * `*_usage_count` is ambiguous across MiniMax server versions: older
     * payloads report the REMAINING count, newer ones the CONSUMED count.
     * The server percentage disambiguates; without it we assume the legacy
     * meaning. Mirrors the official `mmx quota` implementation.
     */
    function resolveQuotaCounts(reportedCount, total, remainingPercent) {
      if (!Number.isFinite(reportedCount) || !Number.isFinite(total)) return undefined
      if (total <= 0 || reportedCount < 0 || reportedCount > total) return undefined
      if (remainingPercent === null || remainingPercent === undefined || !Number.isFinite(remainingPercent)) {
        return { used: total - reportedCount, remaining: reportedCount, total }
      }
      const asRemaining = (reportedCount / total) * 100
      const asUsed = ((total - reportedCount) / total) * 100
      const remainingDistance = Math.abs(asRemaining - remainingPercent)
      const usedDistance = Math.abs(asUsed - remainingPercent)
      if (Math.min(remainingDistance, usedDistance) > 1) return undefined
      const remaining = usedDistance < remainingDistance ? total - reportedCount : reportedCount
      return { used: total - remaining, remaining, total }
    }

    function windowStats(options) {
      const boostFactor = options.boost > 0 ? options.boost / 1000 : 1
      const stats = {
        unlimited: false,
        exhausted: false,
        percent: null,
        basePercent: null,
        boostFactor: 1,
        remaining: null,
        used: null,
        total: null,
      }
      if (options.status === 3) {
        stats.unlimited = true
        stats.boostFactor = boostFactor
        return stats
      }
      if (options.status === 2) {
        stats.exhausted = true
        stats.percent = 0
        stats.boostFactor = boostFactor
        return stats
      }
      const counts = resolveQuotaCounts(options.count, options.total, options.percent)
      if (counts) {
        stats.remaining = counts.remaining
        stats.used = counts.used
        stats.total = counts.total
      }
      if (options.percent !== null && options.percent !== undefined && Number.isFinite(options.percent)) {
        stats.basePercent = clampPct(options.percent)
        stats.percent = clampPct(options.percent * boostFactor)
      } else if (counts) {
        stats.basePercent = clampPct((counts.remaining / counts.total) * 100)
        stats.percent = clampPct(stats.basePercent * boostFactor)
      }
      stats.boostFactor = boostFactor
      return stats
    }

    function isUnavailablePlan(row) {
      return row.current_interval_total_count === 0
        && row.current_weekly_total_count === 0
        && row.current_interval_status === 3
        && row.current_weekly_status === 3
    }

    /**
     * The absolute instant a window resets. The API reports the window end
     * directly; the remaining duration is only a fallback for payloads that
     * omit it. A countdown would keep ticking while the reset moment itself
     * stands still, so the panel shows the instant instead.
     */
    function absoluteReset(endTime, remaining, fetchedAt) {
      const end = numberOrNull(endTime)
      if (end !== null && end > 0) return end
      const left = numberOrNull(remaining)
      if (left !== null && left >= 0) return fetchedAt + left
      return null
    }

    function buildSnapshot(payload) {
      const rows = Array.isArray(payload && payload.model_remains) ? payload.model_remains : []
      const fetchedAt = Date.now()
      const models = rows.filter((row) => !isUnavailablePlan(row)).map((row) => {
        const intervalSpan = row.end_time > row.start_time ? row.end_time - row.start_time : null
        const weeklySpan = row.weekly_end_time > row.weekly_start_time ? row.weekly_end_time - row.weekly_start_time : null
        return {
          name: row.model_name || '—',
          interval: windowStats({
            total: numberOrNull(row.current_interval_total_count) ?? 0,
            count: numberOrNull(row.current_interval_usage_count) ?? 0,
            percent: numberOrNull(row.current_interval_remaining_percent),
            status: row.current_interval_status,
            boost: 0,
          }),
          weekly: windowStats({
            total: numberOrNull(row.current_weekly_total_count) ?? 0,
            count: numberOrNull(row.current_weekly_usage_count) ?? 0,
            percent: numberOrNull(row.current_weekly_remaining_percent),
            status: row.current_weekly_status,
            boost: numberOrNull(row.weekly_boost_permille) ?? 0,
          }),
          intervalSpan,
          weeklySpan,
          intervalResetAt: absoluteReset(row.end_time, row.remains_time, fetchedAt),
          weeklyResetAt: absoluteReset(row.weekly_end_time, row.weekly_remains_time, fetchedAt),
        }
      })
      return { models, fetchedAt }
    }

    /**
     * The model the session actually burns: the MiniMax text plans expose a
     * five-hour window, while image/video rows expose their own (daily) quota.
     * The primary model is the lowest five-hour consumer of that group; its
     * weekly row is the shared weekly quota of the same plan.
     */
    function primaryEntry(snapshot) {
      const models = snapshot && Array.isArray(snapshot.models) ? snapshot.models : []
      if (!models.length) return null
      const fiveHourModels = models.filter((model) => model.intervalSpan === null
        || (model.intervalSpan >= FIVE_HOURS_MIN_MS && model.intervalSpan <= FIVE_HOURS_MAX_MS))
      const pool = fiveHourModels.length ? fiveHourModels : models
      return pickLowest(pool.map((model) => ({ model, window: 'interval', stats: model.interval })))
    }

    /**
     * Picks the entry the configured metric points at.
     * Returns `{ model, window, stats }` or null when the plan reports nothing.
     */
    function pickMetric(snapshot, metric) {
      const models = snapshot && Array.isArray(snapshot.models) ? snapshot.models : []
      if (!models.length) return null

      const primary = primaryEntry(snapshot)
      if (metric === 'weekly') {
        return primary ? { model: primary.model, window: 'weekly', stats: primary.model.weekly } : null
      }
      if (metric === 'lowestPercent') {
        const entries = []
        models.forEach((model) => {
          entries.push({ model, window: 'interval', stats: model.interval })
          entries.push({ model, window: 'weekly', stats: model.weekly })
        })
        return pickLowest(entries)
      }
      if (metric === 'lowestAbsolute') {
        const entries = []
        models.forEach((model) => {
          if (model.interval.remaining !== null) entries.push({ model, window: 'interval', stats: model.interval })
          if (model.weekly.remaining !== null) entries.push({ model, window: 'weekly', stats: model.weekly })
        })
        if (!entries.length) return null
        return entries.reduce((best, entry) => (entry.stats.remaining < best.stats.remaining ? entry : best), entries[0])
      }
      return primary
    }

    function pickLowest(entries) {
      if (!entries.length) return null
      const scored = entries.filter((entry) => !entry.stats.unlimited && entry.stats.percent !== null)
      if (scored.length) {
        return scored.reduce((best, entry) => (entry.stats.percent < best.stats.percent ? entry : best), scored[0])
      }
      const unlimited = entries.find((entry) => entry.stats.unlimited)
      return unlimited || entries[0]
    }

    /** Percent rendered for an entry, including the "∞" case. */
    function percentText(stats) {
      if (!stats) return '—'
      if (stats.unlimited) return '∞'
      if (stats.percent === null) return '—'
      // A boosted plan can report more than the display cap; mark it as a
      // lower bound instead of showing a false exact number.
      return stats.percent >= MAX_DISPLAY_PCT ? `${MAX_DISPLAY_PCT}%+` : `${stats.percent}%`
    }

    /**
     * The same reading with a textual cue, so the state never depends on
     * colour alone: an exhausted window is named, an unlimited window is
     * named, and a low window carries a warning glyph.
     */
    function stateText(stats, t) {
      if (!stats) return '—'
      if (stats.unlimited) return t('panel.unlimited')
      if (stats.exhausted) return t('panel.exhausted')
      const percent = percentText(stats)
      if (stats.percent !== null && stats.percent <= 20) return `${t('pill.warn')}${percent}`
      return percent
    }

    /** Turns a stored failure into a readable message. */
    function errorText(message, t) {
      if (!message) return t('pill.error')
      if (message === 'REQUEST_FAILED') return t('settings.error.request')
      if (message === 'WEB_CRYPTO_UNAVAILABLE') return t('settings.error.crypto')
      if (message === 'VAULT_UNAVAILABLE') return t('settings.error.vault')
      return message
    }

    /**
     * MiniMax grants some plans a multiplier on the weekly window, so the
     * remaining share can read above 100 %. The boost is reported instead of
     * hidden: the note names the multiplier and the underlying share.
     */
    function boostFactorText(stats) {
      const factor = stats && stats.boostFactor ? stats.boostFactor : 1
      if (Number.isInteger(factor)) return String(factor)
      return factor.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
    }

    function boostNote(stats, t) {
      if (!stats || !(stats.boostFactor > 1)) return ''
      const base = stats.basePercent !== null && stats.basePercent !== undefined
        ? `${stats.basePercent}%`
        : '—'
      return t('panel.boostNote', { factor: boostFactorText(stats), base })
    }

    function boostInline(stats, t) {
      if (!stats || !(stats.boostFactor > 1)) return ''
      return t('panel.boostInline', { factor: boostFactorText(stats) })
    }

    /* ------------------------------------------------------------------ *
     * Store
     * ------------------------------------------------------------------ */

    const store = (() => {
      let state = {
        status: 'idle',
        error: null,
        snapshot: null,
        metric: DEFAULT_PREFS.metric,
        region: DEFAULT_PREFS.region,
        refreshMinutes: DEFAULT_PREFS.refreshMinutes,
        hasKey: false,
        updatedAt: null,
      }
      const listeners = new Set()
      let loadPromise = null
      let preferredBase = null
      let inflight = null

      function set(patch) {
        state = Object.assign({}, state, patch)
        listeners.forEach((listener) => {
          try {
            listener()
          } catch (error) {
            console.error('minimax token plan subscriber crashed:', error)
          }
        })
      }

      function subscribe(listener) {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      }

      function getState() {
        return state
      }

      async function load() {
        if (!loadPromise) {
          loadPromise = (async () => {
            try {
              const prefs = await readPrefs()
              if (prefs && typeof prefs === 'object') {
                set({
                  metric: METRIC_IDS.indexOf(prefs.metric) >= 0 ? prefs.metric : DEFAULT_PREFS.metric,
                  region: prefs.region === 'cn' || prefs.region === 'global' ? prefs.region : DEFAULT_PREFS.region,
                  refreshMinutes: Number.isFinite(prefs.refreshMinutes) && prefs.refreshMinutes >= 1
                    ? Math.min(60, Math.round(prefs.refreshMinutes))
                    : DEFAULT_PREFS.refreshMinutes,
                })
              }
              const blob = await openDatabase().then(async (database) => {
                try {
                  return await databaseGet(database, DB_KEY_SECRET)
                } finally {
                  database.close()
                }
              })
              set({ hasKey: !!blob })
            } catch (error) {
              set({ error: messageOf(error) })
            }
          })()
        }
        return loadPromise
      }

      async function fetchQuota(apiKey, region) {
        const bases = []
        const push = (base) => {
          if (base && bases.indexOf(base) < 0) bases.push(base)
        }
        if (region === 'cn' || region === 'global') {
          push(REGION_BASE[region])
        } else {
          push(preferredBase)
          push(REGION_BASE.global)
          push(REGION_BASE.cn)
        }
        let failure = ''
        for (const base of bases) {
          try {
            const response = await fetch(base + QUOTA_PATH, {
              method: 'GET',
              headers: { Authorization: `Bearer ${apiKey}` },
            })
            let payload = null
            try {
              payload = await response.json()
            } catch (error) {
              payload = null
            }
            const baseResp = payload && payload.base_resp
            if (baseResp && baseResp.status_code === 0 && Array.isArray(payload.model_remains)) {
              preferredBase = base
              return payload
            }
            failure = (baseResp && baseResp.status_msg) || `HTTP ${response.status}`
          } catch (error) {
            failure = messageOf(error)
          }
        }
        throw new Error(failure || 'REQUEST_FAILED')
      }

      async function refresh(force) {
        await load()
        if (!state.hasKey) {
          set({ status: 'unconfigured', snapshot: null, error: null })
          return
        }
        if (!force && state.status === 'loading') return
        if (inflight) {
          if (!force) return inflight
          // A forced refresh (for example right after the key changed) waits for
          // the running request so it cannot be answered with stale data.
          try {
            await inflight
          } catch (error) {
            /* the previous request already reported its own failure */
          }
        }
        set({ status: 'loading' })
        inflight = (async () => {
          try {
            const apiKey = await decryptSecret()
            if (!apiKey) {
              set({ status: 'unconfigured', hasKey: false, snapshot: null })
              return
            }
            const payload = await fetchQuota(apiKey, state.region)
            const snapshot = buildSnapshot(payload)
            set({
              status: 'ready',
              error: null,
              snapshot,
              updatedAt: Date.now(),
              hasKey: true,
            })
          } catch (error) {
            set({ status: 'error', error: messageOf(error) })
          } finally {
            inflight = null
          }
        })()
        return inflight
      }

      async function saveSecret(value) {
        await encryptSecret(value)
        set({ hasKey: true, error: null })
        await refresh(true)
      }

      async function removeSecret() {
        await clearSecret()
        set({ hasKey: false, status: 'unconfigured', snapshot: null, error: null })
      }

      async function setPrefs(patch) {
        const next = {
          metric: patch.metric !== undefined ? patch.metric : state.metric,
          region: patch.region !== undefined ? patch.region : state.region,
          refreshMinutes: patch.refreshMinutes !== undefined ? patch.refreshMinutes : state.refreshMinutes,
        }
        set(next)
        try {
          await writePrefs(next)
        } catch (error) {
          console.error('minimax token plan could not persist preferences:', error)
        }
      }

      /** Called by the interval: refetch only when the data went stale. */
      function tick() {
        const intervalMs = Math.max(1, state.refreshMinutes) * 60000
        const age = state.updatedAt ? Date.now() - state.updatedAt : Infinity
        if (state.status === 'idle') {
          refresh(false)
          return
        }
        if (state.status === 'error' && age > intervalMs) {
          refresh(false)
          return
        }
        if (age >= intervalMs) refresh(false)
      }

      /** Releases the subscribers when the plugin is disabled. */
      function dispose() {
        listeners.clear()
      }

      return { subscribe, getState, load, refresh, saveSecret, removeSecret, setPrefs, tick, dispose }
    })()

    /* ------------------------------------------------------------------ *
     * Styles
     * ------------------------------------------------------------------ */

    const STYLE = `
.mm-root{display:inline-flex;min-width:0}
.mm-anchor{display:inline-flex;min-width:0;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px))}
.mm-pill{display:inline-flex;align-items:center;gap:6px;box-sizing:border-box;max-width:100%;padding:1px 8px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-variant-numeric:tabular-nums;line-height:inherit;white-space:nowrap}
.mm-pill svg{width:14px;height:14px;flex:none}
button.mm-pill{cursor:pointer}
button.mm-pill[aria-expanded='true']{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
@media (hover:hover){button.mm-pill:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}}
.mm-label{min-width:0;overflow:hidden;text-overflow:ellipsis}
.mm-busy{color:var(--dsw-alias-label-caption)}
.mm-error{color:var(--dsw-alias-state-error-primary)}
.mm-warn{color:var(--dsw-alias-state-warn-primary)}
.mm-tooltip{position:fixed;z-index:1200;box-sizing:border-box;max-width:min(280px,calc(100vw - 24px));padding:4px 8px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-tooltip-bg);color:var(--dsw-alias-tooltip-label);box-shadow:var(--dsw-elevation-prominent);font-size:11px;line-height:16px;text-align:left;white-space:normal;overflow-wrap:anywhere;pointer-events:none}
.mm-panel{position:fixed;z-index:1100;box-sizing:border-box;width:max-content;min-width:min(300px,calc(100vw - 24px));max-width:min(440px,calc(100vw - 24px));padding:16px;border:0;border-radius:var(--dsw-radius-lg);background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);cursor:default;max-height:calc(100dvh - 12px - max(12px,var(--dsh-frame-overlay-top,12px)));overflow-x:hidden;overflow-y:auto;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);position-area:none;top:max(12px,var(--dsh-frame-overlay-top,12px));bottom:max(12px,calc(anchor(top) + 8px));left:max(12px,anchor(left));right:12px;position-try-fallbacks:--dsh-stat-window,--dsh-stat-opposite,--dsh-stat-wide-opposite,--dsh-stat-tall,--dsh-stat-viewport;align-self:end;justify-self:start;height:fit-content;min-height:0;margin:0}
.mm-panel:focus{outline:none}
.mm-title{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:8px;color:var(--dsw-alias-label-primary);font-weight:500}
.mm-title-label{display:inline-flex;align-items:center;gap:6px;min-width:0}
.mm-title-label svg{width:14px;height:14px;flex:none}
.mm-title-value{display:flex;flex-direction:column;align-items:flex-end;gap:2px;font-variant-numeric:tabular-nums}
.mm-rule{margin:8px 0;border-top:.5px solid var(--dsw-alias-border-l2)}
.mm-details{display:grid;grid-template-columns:minmax(76px,auto) minmax(0,1fr);gap:6px 16px;margin:0;color:var(--dsw-alias-label-tertiary)}
.mm-details dt,.mm-details dd{min-width:0;margin:0}
.mm-details dd{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;text-align:right}
.mm-section{margin:0 0 6px;color:var(--dsw-alias-label-primary);font-weight:500}
.mm-table{display:grid;grid-template-columns:minmax(0,1fr) minmax(64px,auto) minmax(64px,auto);gap:4px 12px;margin:0;color:var(--dsw-alias-label-tertiary)}
.mm-table span:nth-child(3n+2),.mm-table span:nth-child(3n+3){text-align:right;font-variant-numeric:tabular-nums}
.mm-table .mm-head{color:var(--dsw-alias-label-caption)}
.mm-table .mm-name{color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mm-field{display:grid;grid-template-columns:minmax(0,1fr);gap:4px;margin:0 0 10px}
.mm-field-label{color:var(--dsw-alias-label-primary)}
.mm-field-hint{color:var(--dsw-alias-label-caption)}
.mm-input,.mm-select{box-sizing:border-box;width:100%;padding:4px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:var(--dsw-specific-input-major);color:var(--dsw-alias-label-primary);font:inherit;font-variant-numeric:tabular-nums}
.mm-input:focus,.mm-select:focus{border-color:var(--dsw-alias-border-selected)}
.mm-input:focus-visible,.mm-select:focus-visible,.mm-button:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}
.mm-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.mm-button{padding:3px 10px;border:1px solid transparent;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-on-color);font:inherit;cursor:pointer}
.mm-button:hover{background:var(--dsw-alias-button-primary-hover)}
.mm-button[disabled]{opacity:.6;cursor:default}
.mm-button.mm-ghost{background:transparent;border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
.mm-button.mm-ghost:hover{background:var(--dsw-alias-interactive-bg-hover)}
.mm-button.mm-danger{background:transparent;border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-state-error-primary)}
.mm-button.mm-danger:hover{background:var(--dsw-alias-interactive-bg-hover)}
.mm-note{margin:0;color:var(--dsw-alias-label-caption)}
.mm-status{margin:0;color:var(--dsw-alias-label-tertiary)}
.mm-status.mm-error{color:var(--dsw-alias-state-error-primary)}
`

    /* ------------------------------------------------------------------ *
     * Icons
     * ------------------------------------------------------------------ */

    function GaugeIcon() {
      return h('svg', {
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.6,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
      }, h('path', { d: 'M12 3a9 9 0 1 0 9 9' }), h('path', { d: 'M12 12l4.5-3.6' }), h('circle', { cx: 12, cy: 12, r: 1.3, fill: 'currentColor', stroke: 'none' }))
    }

    /* ------------------------------------------------------------------ *
     * Components
     * ------------------------------------------------------------------ */

    function useTranslate(props) {
      const injected = props && props.t
      return useMemo(() => {
        if (typeof injected === 'function') return injected
        return (key, params) => {
          let text = EN[key] || key
          if (params) {
            text = text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
          }
          return text
        }
      }, [injected])
    }

    const FOCUSABLE_SELECTOR = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',')

    /** Keeps Tab inside the panel while it is open. */
    function trapTab(event, panelRef) {
      const panel = panelRef.current
      if (!panel) return
      const items = Array.prototype.slice
        .call(panel.querySelectorAll(FOCUSABLE_SELECTOR))
        .filter((element) => element.getClientRects().length > 0)
      if (!items.length) {
        event.preventDefault()
        if (typeof panel.focus === 'function') panel.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      // The panel root itself is focusable (tabIndex -1) so it can receive
      // focus on open; from there Tab has to move to the first control and
      // Shift+Tab to the last one, otherwise the focus escapes the dialog.
      if (active === panel) {
        event.preventDefault()
        if (typeof (event.shiftKey ? last : first).focus === 'function') {
          (event.shiftKey ? last : first).focus()
        }
        return
      }
      const outside = !active || !panel.contains(active)
      if (event.shiftKey && (active === first || outside)) {
        event.preventDefault()
        last.focus()
        return
      }
      if (!event.shiftKey && (active === last || outside)) {
        event.preventDefault()
        first.focus()
      }
    }

    /**
     * A portaled tooltip.
     *
     * The pill lives in the narrow dock row, so a tooltip anchored to it as a
     * pseudo element would be squeezed to the width of the label. The tooltip
     * therefore lives in the document body and is placed from the trigger
     * rectangle, the same way the host portals its own tooltips.
     */
    function useTooltip(text, disabled, triggerRef) {
      const [rect, setRect] = useState(null)
      const show = useCallback(() => {
        if (disabled || !text) return
        const element = triggerRef.current
        if (!element || typeof element.getBoundingClientRect !== 'function') return
        const box = element.getBoundingClientRect()
        setRect({ top: box.top, left: box.left, width: box.width, height: box.height })
      }, [disabled, text, triggerRef])
      const hide = useCallback(() => setRect(null), [])

      let tooltip = null
      if (rect && text && !disabled) {
        const above = rect.top > 48
        const half = 140
        const viewport = typeof window !== 'undefined' ? window.innerWidth : rect.left + rect.width
        const center = rect.left + rect.width / 2
        const left = Math.min(Math.max(center, half + 12), Math.max(half + 12, viewport - half - 12))
        tooltip = createPortal(
          h('div', {
            className: 'mm-tooltip',
            role: 'tooltip',
            style: {
              top: above ? rect.top - 8 : rect.top + rect.height + 8,
              left,
              transform: above ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
            },
          }, text),
          document.body,
        )
      }
      return { tooltip, show, hide }
    }

    function usePanelDismiss(open, setOpen, rootRef, panelRef, triggerRef) {
      useEffect(() => {
        if (!open) return undefined
        function onKeyDown(event) {
          if (event.key === 'Escape') {
            // Keep the host composer from reacting to the same Escape.
            event.stopPropagation()
            event.preventDefault()
            setOpen(false)
            return
          }
          if (event.key === 'Tab') trapTab(event, panelRef)
        }
        function isInside(event) {
          const root = rootRef.current
          const panel = panelRef.current
          if (!root || !panel) return true
          return root.contains(event.target) || panel.contains(event.target)
        }
        function onPointerDown(event) {
          if (isInside(event)) return
          setOpen(false)
        }
        function onClick(event) {
          // Keyboard activation of a sibling trigger fires a click without a
          // pointerdown; closing here keeps two panels from stacking.
          if (isInside(event)) return
          setOpen(false)
        }
        document.addEventListener('keydown', onKeyDown, true)
        document.addEventListener('pointerdown', onPointerDown, true)
        document.addEventListener('click', onClick, true)
        return () => {
          document.removeEventListener('keydown', onKeyDown, true)
          document.removeEventListener('pointerdown', onPointerDown, true)
          document.removeEventListener('click', onClick, true)
        }
      }, [open, rootRef, panelRef, setOpen])

      // Move focus into the panel when it opens and hand it back to the pill
      // when it closes, so the settings form is reachable by keyboard.
      const wasOpen = useRef(false)
      useEffect(() => {
        if (open) {
          wasOpen.current = true
          const frame = requestAnimationFrame(() => {
            const panel = panelRef.current
            if (panel && typeof panel.focus === 'function') panel.focus()
          })
          return () => cancelAnimationFrame(frame)
        }
        if (!wasOpen.current) return undefined
        wasOpen.current = false
        const active = typeof document !== 'undefined' ? document.activeElement : null
        if (!active || active === document.body) {
          const trigger = triggerRef && triggerRef.current
          if (trigger && typeof trigger.focus === 'function') trigger.focus()
        }
        return undefined
      }, [open, panelRef, triggerRef])
    }

    function QuotaPanel(props) {
      const t = useTranslate(props)
      const idPrefix = props.idPrefix || 'mm'
      const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
      const [settingsOpen, setSettingsOpen] = useState(false)
      const [keyDraft, setKeyDraft] = useState('')
      const [busy, setBusy] = useState(false)
      const [notice, setNotice] = useState('')
      const [intervalDraft, setIntervalDraft] = useState(null)

      const snapshot = state.snapshot
      const entry = pickMetric(snapshot, state.metric)
      const metricLabel = t(`metric.${state.metric}`)

      function intervalEntry() {
        const primary = primaryEntry(snapshot)
        return primary ? { model: primary.model, window: 'interval', stats: primary.model.interval } : null
      }

      function weeklyEntry() {
        const primary = primaryEntry(snapshot)
        return primary ? { model: primary.model, window: 'weekly', stats: primary.model.weekly } : null
      }

      const five = intervalEntry()
      const week = weeklyEntry()

      /** A reading with its textual cue and, when the plan reports one, the count. */
      function readingText(stats) {
        if (!stats) return t('panel.noData')
        const parts = [stateText(stats, t)]
        if (stats.remaining !== null) parts.push(formatCount(stats.remaining))
        return parts.join(' · ')
      }

      function windowRow(label, picked, resetLabel) {
        if (!picked) {
          return [
            h('dt', { key: `${label}-label` }, label),
            h('dd', { key: `${label}-value` }, t('panel.noData')),
            h('dt', { key: `${label}-reset-label` }, resetLabel),
            h('dd', { key: `${label}-reset-value` }, t('panel.noData')),
          ]
        }
        const stats = picked.stats
        const resetAt = picked.window === 'interval'
          ? picked.model.intervalResetAt
          : picked.model.weeklyResetAt
        const note = picked.window === 'weekly' ? boostInline(stats, t) : ''
        const rows = [
          h('dt', { key: `${label}-label` }, label),
          h('dd', { key: `${label}-value` }, readingText(stats), note
            ? h('span', { className: 'mm-note', key: `${label}-note` }, ` · ${note}`)
            : null),
          // The reset moment is an absolute date, not a running countdown:
          // the window ends at one instant and does not move.
          h('dt', { key: `${label}-reset-label` }, resetLabel),
          h('dd', { key: `${label}-reset-value` }, formatDateTime(resetAt)),
        ]
        return rows
      }

      async function onSave(event) {
        event.preventDefault()
        const value = keyDraft.trim()
        if (!value) {
          setNotice(t('settings.error.empty'))
          return
        }
        setBusy(true)
        setNotice('')
        try {
          await store.saveSecret(value)
          setKeyDraft('')
          setNotice(t('settings.saved'))
        } catch (error) {
          setNotice(messageOf(error) === 'WEB_CRYPTO_UNAVAILABLE'
            ? t('settings.error.crypto')
            : t('settings.error.failed', { message: messageOf(error) }))
        } finally {
          setBusy(false)
        }
      }

      async function onClear() {
        setBusy(true)
        setNotice('')
        try {
          await store.removeSecret()
          setKeyDraft('')
          setNotice(t('settings.cleared'))
        } catch (error) {
          setNotice(t('settings.error.clearFailed', { message: messageOf(error) }))
        } finally {
          setBusy(false)
        }
      }

      function commitInterval() {
        if (intervalDraft === null) return
        const value = Number.parseInt(intervalDraft, 10)
        setIntervalDraft(null)
        if (Number.isFinite(value) && value >= 1 && value <= 60) {
          store.setPrefs({ refreshMinutes: value })
        } else {
          setNotice(t('settings.error.interval'))
        }
      }

      const children = []

      const titleNote = entry ? boostNote(entry.stats, t) : ''
      children.push(h('div', { className: 'mm-title', key: 'title' },
        h('span', { className: 'mm-title-label' }, h(GaugeIcon, null), h('span', null, t('panel.title'))),
        h('span', { className: 'mm-title-value' },
          h('span', { key: 'value' }, entry ? stateText(entry.stats, t) : t('pill.idle')),
          titleNote ? h('span', { className: 'mm-note', key: 'note' }, titleNote) : null)))

      children.push(h('div', { className: 'mm-rule', key: 'rule-1' }))

      const details = []
      details.push(h('dt', { key: 'displayed-label' }, t('panel.displayed')))
      details.push(h('dd', { key: 'displayed-value' }, metricLabel))
      details.push(...windowRow(t('panel.interval'), five, t('panel.intervalReset')))
      details.push(...windowRow(t('panel.weekly'), week, t('panel.weeklyReset')))
      details.push(h('dt', { key: 'model-label' }, t('panel.model')))
      details.push(h('dd', { key: 'model-value' }, entry && entry.model ? entry.model.name : t('panel.noData')))
      details.push(h('dt', { key: 'updated-label' }, t('panel.updatedAt')))
      details.push(h('dd', { key: 'updated-value' }, state.updatedAt ? formatClock(state.updatedAt) : t('panel.noData')))
      children.push(h('dl', { className: 'mm-details', key: 'details' }, details))

      if (state.status === 'error') {
        children.push(h('p', {
          className: 'mm-status mm-error',
          key: 'error',
          role: 'status',
          'aria-live': 'polite',
        }, errorText(state.error, t)))
      }

      if (snapshot && snapshot.models.length) {
        children.push(h('div', { className: 'mm-rule', key: 'rule-2' }))
        children.push(h('p', { className: 'mm-section', key: 'models-title' }, t('panel.models')))
        const cells = []
        cells.push(h('span', { className: 'mm-head', key: 'h1' }, t('panel.model')))
        cells.push(h('span', { className: 'mm-head', key: 'h2' }, t('panel.interval')))
        cells.push(h('span', { className: 'mm-head', key: 'h3' }, t('panel.weekly')))
        snapshot.models.forEach((model, index) => {
          cells.push(h('span', { className: 'mm-name', key: `n${index}`, title: model.name }, model.name))
          cells.push(h('span', { key: `i${index}` }, readingText(model.interval)))
          cells.push(h('span', { key: `w${index}` }, readingText(model.weekly)))
        })
        children.push(h('div', { className: 'mm-table', key: 'models' }, cells))
        const boosted = snapshot.models.find((model) => model.weekly && model.weekly.boostFactor > 1)
        if (boosted) {
          children.push(h('p', { className: 'mm-note', key: 'boost-note' }, boostNote(boosted.weekly, t)))
        }
        const hasAbsolute = snapshot.models.some((model) => model.interval.remaining !== null || model.weekly.remaining !== null)
        if (!hasAbsolute) {
          children.push(h('p', { className: 'mm-note', key: 'no-absolute' }, t('panel.noAbsolute')))
        }
      }

      children.push(h('div', { className: 'mm-rule', key: 'rule-3' }))

      children.push(h('div', { className: 'mm-row', key: 'actions' },
        h('button', {
          type: 'button',
          className: 'mm-button mm-ghost',
          onClick: () => store.refresh(true),
        }, t('panel.refresh')),
        h('button', {
          type: 'button',
          className: 'mm-button mm-ghost',
          'aria-expanded': settingsOpen,
          'aria-controls': `${idPrefix}-settings`,
          onClick: () => setSettingsOpen((value) => !value),
        }, t('panel.settings'))))

      // One live region that stays mounted while the panel is open: a screen
      // reader only announces a change inside a region that already exists.
      children.push(h('p', {
        className: 'mm-status',
        key: 'notice',
        role: 'status',
        'aria-live': 'polite',
      }, notice))

      if (settingsOpen) {
        children.push(h('div', { className: 'mm-rule', key: 'rule-4' }))
        const settingsChildren = []

        settingsChildren.push(h('form', { className: 'mm-field', key: 'key-form', onSubmit: onSave },
          h('label', { className: 'mm-field-label', htmlFor: `${idPrefix}-api-key` }, t('settings.apiKey')),
          h('input', {
            id: `${idPrefix}-api-key`,
            className: 'mm-input',
            type: 'password',
            autoComplete: 'off',
            spellCheck: false,
            placeholder: t('settings.apiKeyPlaceholder'),
            'aria-describedby': `${idPrefix}-api-key-hint`,
            value: keyDraft,
            onChange: (event) => setKeyDraft(event.target.value),
          }),
          h('p', { className: 'mm-field-hint', id: `${idPrefix}-api-key-hint` }, t('settings.apiKeyHint')),
          h('div', { className: 'mm-row' },
            h('button', { type: 'submit', className: 'mm-button', disabled: busy }, busy ? t('settings.saving') : t('settings.save')))))

        settingsChildren.push(h('div', { className: 'mm-row', key: 'key-clear-row' },
          h('button', { type: 'button', className: 'mm-button mm-danger', disabled: busy, onClick: onClear }, t('settings.clear')),
          h('span', { className: 'mm-field-hint' }, state.hasKey ? t('settings.keyPresent') : t('settings.keyMissing'))))

        settingsChildren.push(h('div', { className: 'mm-field', key: 'metric-field' },
          h('label', { className: 'mm-field-label', htmlFor: `${idPrefix}-metric` }, t('settings.metric')),
          h('select', {
            id: `${idPrefix}-metric`,
            className: 'mm-select',
            value: state.metric,
            onChange: (event) => store.setPrefs({ metric: event.target.value }),
          }, METRIC_IDS.map((id) => h('option', { key: id, value: id }, t(`metric.${id}`))))))

        settingsChildren.push(h('div', { className: 'mm-field', key: 'region-field' },
          h('label', { className: 'mm-field-label', htmlFor: `${idPrefix}-region` }, t('settings.region')),
          h('select', {
            id: `${idPrefix}-region`,
            className: 'mm-select',
            value: state.region,
            onChange: (event) => store.setPrefs({ region: event.target.value }),
          },
          h('option', { key: 'auto', value: 'auto' }, t('settings.region.auto')),
          h('option', { key: 'global', value: 'global' }, t('settings.region.global')),
          h('option', { key: 'cn', value: 'cn' }, t('settings.region.cn')))))

        settingsChildren.push(h('div', { className: 'mm-field', key: 'interval-field' },
          h('label', { className: 'mm-field-label', htmlFor: `${idPrefix}-interval` }, t('settings.refreshMinutes')),
          h('input', {
            id: `${idPrefix}-interval`,
            className: 'mm-input',
            type: 'number',
            min: 1,
            max: 60,
            step: 1,
            'aria-describedby': `${idPrefix}-interval-hint`,
            value: intervalDraft === null ? String(state.refreshMinutes) : intervalDraft,
            onChange: (event) => setIntervalDraft(event.target.value),
            onBlur: commitInterval,
            onKeyDown: (event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                commitInterval()
              }
            },
          }),
          h('p', { className: 'mm-field-hint', id: `${idPrefix}-interval-hint` }, t('settings.refreshHint'))))

        settingsChildren.push(h('p', { className: 'mm-note', key: 'security' }, t('settings.security')))

        children.push(h('div', {
          className: 'mm-settings',
          key: 'settings',
          id: `${idPrefix}-settings`,
        }, settingsChildren))
      }

      return h('div', {
        ref: props.panelRef,
        id: props.panelId,
        className: 'mm-panel',
        role: 'dialog',
        'aria-modal': true,
        'aria-label': t('panel.title'),
        tabIndex: -1,
        style: { positionAnchor: props.anchorName },
      }, children)
    }

    let stylesInjected = false

    /** The stylesheet is owned by the plugin and lives in the document head. */
    function ensureStyles() {
      if (stylesInjected) return
      if (typeof document === 'undefined' || !document.head) return
      if (document.querySelector('style[data-dsh-minimax-token-plan]')) {
        stylesInjected = true
        return
      }
      const element = document.createElement('style')
      element.setAttribute('data-dsh-minimax-token-plan', '')
      element.textContent = STYLE
      document.head.appendChild(element)
      stylesInjected = true
    }

    function MiniMaxTokenPlanPill(props) {
      const t = useTranslate(props)
      const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
      const [open, setOpen] = useState(false)
      const rootRef = useRef(null)
      const panelRef = useRef(null)
      const triggerRef = useRef(null)
      const anchorId = useRef(null)
      if (anchorId.current === null) {
        anchorId.current = `mm${Math.random().toString(36).slice(2, 9)}`
      }
      const anchorName = `--dsh-mm-${anchorId.current}`
      const panelId = `${anchorId.current}-panel`

      usePanelDismiss(open, setOpen, rootRef, panelRef, triggerRef)

      useEffect(() => {
        ensureStyles()
        // Only fetch when the data is missing or stale; mounting a second
        // composer must not trigger another request.
        store.tick()
      }, [])

      const entry = pickMetric(state.snapshot, state.metric)
      const metricLabel = t(`metric.${state.metric}`)

      let label = t('pill.idle')
      let tip = t('pill.tip.none')
      let tone = ''
      if (state.status === 'idle' || (state.status === 'loading' && !entry)) {
        label = t('pill.loading')
        tip = t('pill.tip.loading')
        tone = 'mm-busy'
      } else if (state.status === 'unconfigured' || (!state.hasKey && state.status !== 'error')) {
        label = t('pill.unconfigured')
        tip = t('pill.tip.unconfigured')
      } else if (state.status === 'error') {
        label = t('pill.error')
        tip = t('pill.tip.error', { message: errorText(state.error, t) })
        tone = 'mm-error'
      } else if (entry) {
        label = stateText(entry.stats, t)
        tip = t('pill.tip.ready', { metric: metricLabel, value: label })
        // A boosted window reads above 100 %; the tooltip names the boost so
        // the number never looks like a bug.
        const note = boostNote(entry.stats, t)
        if (note) tip = `${tip} · ${note}`
        // The low band carries a warning glyph as well as a colour, and the
        // healthy band keeps the resting colour, so the state is never
        // encoded in colour alone.
        if (entry.stats.exhausted || (entry.stats.percent !== null && entry.stats.percent <= 20)) tone = 'mm-warn'
      }

      const tooltip = useTooltip(tip, open, triggerRef)

      return h('span', { className: 'mm-root', key: 'root' },
        h('span', { ref: rootRef, style: { anchorName }, className: 'mm-anchor', 'data-composer-stat': SLOT_ID, key: 'anchor' },
          h('button', {
            ref: triggerRef,
            type: 'button',
            className: `mm-pill ${tone}`.trim(),
            'aria-haspopup': 'dialog',
            'aria-expanded': open,
            'aria-controls': panelId,
            'aria-label': `${label} · ${tip}`,
            onClick: () => setOpen((value) => !value),
            onMouseEnter: tooltip.show,
            onMouseLeave: tooltip.hide,
            onFocus: tooltip.show,
            onBlur: tooltip.hide,
          },
          h(GaugeIcon, null),
          h('span', { className: 'mm-label' }, label)),
          tooltip.tooltip,
          open && createPortal(
            h(QuotaPanel, { panelRef, t, idPrefix: anchorId.current, anchorName, panelId }),
            document.body,
          )))
    }

    /* ------------------------------------------------------------------ *
     * Plugin entry
     * ------------------------------------------------------------------ */

    const plugin = {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'minimax token plan: dictionaries')

        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: SLOT_ID,
          order: 2,
          locale: NS,
        }, MiniMaxTokenPlanPill))

        ctx.effect(() => {
          const timer = setInterval(() => store.tick(), TICK_MS)
          return () => clearInterval(timer)
        }, 'minimax token plan: polling')

        return () => {
          store.dispose()
        }
      },
    }

    // Test hook: only attached when the host opts in before loading the
    // bundle, so a production bundle exposes nothing extra.
    if (typeof globalThis !== 'undefined' && globalThis.__DSH_MINIMAX_TOKEN_PLAN_TEST__) {
      plugin.__internals = {
        resolveQuotaCounts,
        windowStats,
        buildSnapshot,
        pickMetric,
        primaryEntry,
        percentText,
        stateText,
        errorText,
        formatDateTime,
        absoluteReset,
        clampPct,
        boostNote,
        boostInline,
        boostFactorText,
      }
    }
    return plugin
  },
})
