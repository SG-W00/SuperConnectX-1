export default interface ConnectionInfo {
  host: string
  port: number
  username: string
  password: string
  sessionId: string
  // 串口参数
  comName?: string
  baudRate?: number
  dataBits?: 5 | 6 | 7 | 8
  stopBits?: 1 | 1.5 | 2
  parity?: 'none' | 'even' | 'odd' | 'mark' | 'space'
  // 扩展参数
  encoding?: string
  readTimeout?: number
  writeTimeout?: number
  /** 分包超时（ms）：无换行数据停留超过该时长即强制输出，0 表示禁用（仅按换行符/空闲刷新输出） */
  packetTimeout?: number
  // 流控制参数
  flowControl?: 'none' | 'hardware' | 'software'
  rts?: boolean
  dtr?: boolean
  // 数据接收格式
  receiveHex?: boolean
  // FTP 参数
  ftpMode?: 'server' | 'client'
  ftpDirectory?: string
  ftpPermissions?: string[]
}
