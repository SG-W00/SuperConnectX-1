/**
 * Connection navigation feature state: saved connections, serial ports, search,
 * grouping and sidebar preferences.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'

export type SerialPortType = 'virtual' | 'usb' | 'bluetooth' | 'none'

export function getSerialPortDisplayName(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop() || path
}

export function useConnectionSidebar() {
  const { t } = useI18n()
  const connections = ref<any[]>([])
  const searchKeyword = ref('')
  const filterConnection = ref<any[]>([])
  const serialPorts = ref<SerialPortInfo[]>([])
  const showConnectionList = ref(true)
  const showBottomPanel = ref(true)
  const sidebarWidth = ref(320)
  const serialPortExpanded = ref(true)
  const showPortType = ref(true)
  const showSerialPortFriendlyName = ref(true)
  const showSerialPortDetails = ref(false)
  const connectionGroupExpanded = ref<Record<string, boolean>>({ telnet: true, ftp: true, ssh: true })
  // 连接列表排序：按名称 / 按添加顺序（存储返回的原始顺序），可升/降序
  const connectionSortBy = ref<'name' | 'addOrder'>('addOrder')
  const connectionSortDir = ref<'asc' | 'desc'>('asc')

  const parseSerialPortType = (port: SerialPortInfo): SerialPortType => {
    const text = [port.path, port.friendlyName, port.manufacturer, port.pnpId].filter(Boolean).join(' ').toLowerCase()
    if (text.includes('virtual')) return 'virtual'
    if (text.includes('usb')) return 'usb'
    if (text.includes('蓝牙') || text.includes('ble') || text.includes('bluetooth low energy') || text.includes('bluetooth smart') || text.includes('bluetooth le')) return 'bluetooth'
    return 'none'
  }

  const filterList = (): void => {
    if (!searchKeyword.value) {
      filterConnection.value = connections.value
      return
    }
    const keyword = searchKeyword.value.toLowerCase()
    filterConnection.value = connections.value.filter(item =>
      item.name?.toLowerCase().includes(keyword) || item.connectionType?.toLowerCase().includes(keyword) || item.host?.toLowerCase().includes(keyword) || String(item.port).includes(keyword)
    )
  }
  const filteredSerialPorts = computed(() => {
    const keyword = searchKeyword.value.toLowerCase()
    let ports = serialPorts.value
    if (keyword) {
      ports = ports.filter(port => [port.path, port.friendlyName, port.manufacturer, port.vendorId, port.productId, port.serialNumber, port.pnpId, port.locationId].some(value => value?.toLowerCase().includes(keyword)))
    }
    // 按名称排序时使用自然排序（COM2 < COM10），按添加顺序保持原始顺序
    if (connectionSortBy.value === 'name') {
      const dir = connectionSortDir.value === 'asc' ? 1 : -1
      ports = ports.slice().sort((a, b) => {
        const cmp = String(a.path || '').localeCompare(String(b.path || ''), undefined, { numeric: true, sensitivity: 'base' })
        return cmp * dir
      })
    }
    return ports
  })
  const connectionGroups = computed(() => {
    const groups: Record<string, any[]> = {}
    const list = filterConnection.value.slice()
    if (connectionSortBy.value === 'name') {
      list.sort((a, b) => {
        const cmp = String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' })
        return connectionSortDir.value === 'asc' ? cmp : -cmp
      })
    }
    // 'addOrder' 保持存储返回的原始顺序，不做排序
    list.forEach(connection => {
      const type = connection.connectionType || 'other'
      ;(groups[type] ??= []).push(connection)
    })
    return groups
  })
  const handleSearch = (keyword: string): void => { searchKeyword.value = keyword }

  const loadConnections = async (): Promise<void> => {
    try {
      const savedConnections = await window.storageApi.getConnections()
      connections.value = Array.isArray(savedConnections) ? savedConnections : []
    } catch (error) {
      ElMessage.error(t('dialog.loadFailed'))
      console.error(t('dialog.loadFailed'), error)
      connections.value = []
    }
  }
  const applySerialPortTypes = (ports: SerialPortInfo[]): SerialPortInfo[] => ports.map(port => ({ ...port, type: parseSerialPortType(port) }))
  const loadSerialPorts = async (): Promise<void> => {
    try {
      serialPorts.value = applySerialPortTypes(await window.connectApi.listSerialPorts())
    } catch (error) {
      console.error(t('notification.scanPortsFailed'), error)
      serialPorts.value = []
    }
  }
  const handleSerialPortsChanged = (ports: SerialPortInfo[]): void => { serialPorts.value = applySerialPortTypes(ports) }

  const loadSidebarState = async (): Promise<void> => {
    try {
      const savedState = await window.storageApi.getAppSettings()
      if (savedState?.sidebar) {
        showConnectionList.value = savedState.sidebar.showConnectionList ?? true
        showBottomPanel.value = savedState.sidebar.showBottomPanel ?? true
        serialPortExpanded.value = savedState.sidebar.serialPortExpanded ?? true
        if (savedState.sidebar.sidebarWidth) sidebarWidth.value = savedState.sidebar.sidebarWidth
        connectionGroupExpanded.value = { ...connectionGroupExpanded.value, ...savedState.sidebar.connectionGroupExpanded }
        if (savedState.sidebar.connectionSortBy === 'name' || savedState.sidebar.connectionSortBy === 'addOrder') {
          connectionSortBy.value = savedState.sidebar.connectionSortBy
        }
        if (savedState.sidebar.connectionSortDir === 'asc' || savedState.sidebar.connectionSortDir === 'desc') {
          connectionSortDir.value = savedState.sidebar.connectionSortDir
        }
      }
      const settings = await window.storageApi.getSettings()
      showPortType.value = settings.showPortType ?? true
      showSerialPortFriendlyName.value = settings.showSerialPortFriendlyName ?? true
      showSerialPortDetails.value = settings.showSerialPortDetails ?? false
    } catch (error) {
      console.error(t('common.loadFailed'), error)
    }
  }
  const saveSidebarState = async (): Promise<void> => {
    try {
      const currentSettings = await window.storageApi.getAppSettings()
      await window.storageApi.saveAppSettings({
        ...currentSettings,
        sidebar: {
          showConnectionList: Boolean(showConnectionList.value),
          showBottomPanel: Boolean(showBottomPanel.value),
          serialPortExpanded: Boolean(serialPortExpanded.value),
          sidebarWidth: Number(sidebarWidth.value),
          connectionGroupExpanded: JSON.parse(JSON.stringify(connectionGroupExpanded.value)),
          connectionSortBy: connectionSortBy.value,
          connectionSortDir: connectionSortDir.value
        }
      })
    } catch (error) {
      console.error(t('common.saveFailed'), error)
    }
  }
  const toggleConnectionList = (): void => { showConnectionList.value = !showConnectionList.value }
  const toggleBottomPanel = (): void => { showBottomPanel.value = !showBottomPanel.value }

  watch([showConnectionList, showBottomPanel, serialPortExpanded, connectionGroupExpanded, sidebarWidth, connectionSortBy, connectionSortDir], saveSidebarState, { deep: true })
  watch([connections, searchKeyword], filterList, { immediate: true, deep: true })

  /** 应用设置更新（settings-updated 事件 detail）中与侧栏展示相关的偏好 */
  const applySettings = (settings: {
    showPortType?: boolean
    showSerialPortFriendlyName?: boolean
    showSerialPortDetails?: boolean
  } | null | undefined): void => {
    if (!settings) return
    if ('showPortType' in settings) showPortType.value = !!settings.showPortType
    if ('showSerialPortFriendlyName' in settings) showSerialPortFriendlyName.value = !!settings.showSerialPortFriendlyName
    if ('showSerialPortDetails' in settings) showSerialPortDetails.value = !!settings.showSerialPortDetails
  }

  return { connections, searchKeyword, filterConnection, serialPorts, showConnectionList, showBottomPanel, sidebarWidth, serialPortExpanded, showPortType, showSerialPortFriendlyName, showSerialPortDetails, connectionGroupExpanded, filteredSerialPorts, connectionGroups, connectionSortBy, connectionSortDir, handleSearch, loadConnections, loadSerialPorts, handleSerialPortsChanged, loadSidebarState, saveSidebarState, toggleConnectionList, toggleBottomPanel, parseSerialPortType, applySettings }
}
