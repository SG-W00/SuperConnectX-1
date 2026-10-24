/**
 * ComClient 测试
 * 使用 mock 的 serialport 库测试 ComClient 核心逻辑
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock serialport（原生模块，测试中无法加载）
vi.mock('serialport', () => {
  class MockSerialPort {
    private listeners: Map<string, Function[]> = new Map()
    path: string
    baudRate: number
    isOpen = true

    constructor(opts: any) {
      this.path = opts.path
      this.baudRate = opts.baudRate
    }

    on(event: string, callback: Function): void {
      if (!this.listeners.has(event)) {
        this.listeners.set(event, [])
      }
      this.listeners.get(event)!.push(callback)
    }

    once(event: string, callback: Function): void {
      this.on(event, callback)
    }

    removeAllListeners(event?: string): void {
      if (event) {
        this.listeners.delete(event)
      } else {
        this.listeners.clear()
      }
    }

    open(callback: (err: Error | null) => void): void {
      setImmediate(() => {
        this.emit('open')
        callback(null)
      })
    }

    write(_data: any, _encoding: any, callback: (err: Error | null) => void): void {
      callback(null)
    }

    close(callback?: (err: Error | null) => void): void {
      this.isOpen = false
      callback?.(null)
    }

    // Helper for tests
    emit(event: string, ...args: any[]): void {
      const cbs = this.listeners.get(event) || []
      cbs.forEach(cb => cb(...args))
    }
  }

  return { SerialPort: MockSerialPort }
})

import ComClient from '@/main/protocol/ComClient'

describe('ComClient', () => {
  let client: ComClient

  beforeEach(() => {
    client = new ComClient()
  })

  const startConnection = async (
    sessionId: string,
    onData = vi.fn(),
    onLog = vi.fn(),
    overrides: Record<string, unknown> = {}
  ) => {
    const result = await client.start(
      {
        comName: 'COM1',
        sessionId,
        host: '',
        port: 0,
        username: '',
        password: '',
        ...overrides
      },
      onData, vi.fn(), onLog
    )
    return { result, onData, onLog }
  }

  describe('start()', () => {
    it('should return success on open', async () => {
      const { result } = await startConnection('s1')
      expect((result as any).success).toBe(true)
      expect(client.serialConnections.has('s1')).toBe(true)
    })

    it('should fail without comName', async () => {
      const result = await client.start(
        { comName: '', sessionId: 's2', host: '', port: 0, username: '', password: '' },
        vi.fn(), vi.fn(), vi.fn()
      )
      expect((result as any).success).toBe(false)
    })
  })

  describe('receive buffer cap', () => {
    it('should force-flush buffer exceeding 1MB when no newline arrives', async () => {
      const onData = vi.fn()
      const onLog = vi.fn()
      await startConnection('cap-1', onData, onLog)

      const connection = client.serialConnections.get('cap-1')!
      // 模拟设备持续发送不带换行符的内容（split 会一直保留 remainder，
      // 且持续有数据时空闲刷新 checkFlushBuffer 不会触发）
      connection.buffer = Buffer.alloc(1024 * 1024 + 1, 'a')
      ;(client as any).processBuffer(connection)

      expect(onData).toHaveBeenCalledTimes(1)
      expect(onData.mock.calls[0][0].data.length).toBe(1024 * 1024 + 1)
      expect(onLog).toHaveBeenCalledTimes(1)
      expect(connection.buffer.length).toBe(0)
    })

    it('should keep buffer below the cap for the next chunk', async () => {
      const onData = vi.fn()
      await startConnection('cap-2', onData)

      const connection = client.serialConnections.get('cap-2')!
      connection.buffer = Buffer.from('no newline yet')
      ;(client as any).processBuffer(connection)

      expect(onData).not.toHaveBeenCalled()
      expect(connection.buffer.toString()).toBe('no newline yet')
    })
  })

  describe('pending line flush (no newline)', () => {
    it('should flush partial data while the device keeps sending without newline', async () => {
      // 回归测试：设备持续发送不带换行符的数据时，lastDataTime 会被不断刷新，
      // 空闲刷新（checkFlushBuffer）永不触发，数据会一直压在 buffer 里不显示，
      // 用户会误以为死机或丢日志。部分行停留超时必须把数据按时输出。
      const onData = vi.fn()
      const onLog = vi.fn()
      await startConnection('pending-1', onData, onLog)

      const connection = client.serialConnections.get('pending-1')!
      const send = (chunk: string): void => connection.port.emit('data', Buffer.from(chunk))

      // 每 50ms 发一段不带换行符的数据，持续 500ms（远超默认 50ms 分包超时）
      for (let i = 0; i < 10; i++) {
        send('chunk' + i + ' ')
        await new Promise((r) => setTimeout(r, 50))
      }

      // 停止发送后再等一个分包超时 + 余量，最后一段也必须被输出
      await new Promise((r) => setTimeout(r, 120))

      // 数据必须已经显示，而不是全压在 buffer 里
      expect(onData).toHaveBeenCalled()
      expect(connection.buffer.length).toBe(0)
      const displayed = onData.mock.calls.map((c) => c[0].data).join('')
      expect(displayed).toContain('chunk0')
      expect(displayed).toContain('chunk9')
      expect(onLog).toHaveBeenCalled()
    }, 10000)

    it('should not flush a partial line before the pending timeout elapses', async () => {
      const onData = vi.fn()
      await startConnection('pending-2', onData)

      const connection = client.serialConnections.get('pending-2')!
      connection.port.emit('data', Buffer.from('partial'))

      // 停留时间未超过 200ms，应继续等待换行符
      await new Promise((r) => setTimeout(r, 50))

      expect(onData).not.toHaveBeenCalled()
      expect(connection.buffer.toString()).toBe('partial')

      // 换行符在超时前到达，必须作为完整的一行输出（不能被提前拆开）
      connection.port.emit('data', Buffer.from(' line\r\n'))
      await new Promise((r) => setTimeout(r, 50))

      expect(onData).toHaveBeenCalledTimes(1)
      expect(onData.mock.calls[0][0].data).toBe('partial line')
    }, 10000)

    it('should keep incomplete multi-byte characters pending on a pending flush', async () => {
      // 部分行刷新输出的是"已完整可解码的前缀"，尾部残缺多字节字符必须继续留在 buffer 中，
      // 否则中文/Emoji 会被打碎成乱码。
      const onData = vi.fn()
      const onLog = vi.fn()
      await startConnection('pending-3', onData, onLog)

      const connection = client.serialConnections.get('pending-3')!
      // 构造「已完整可解码前缀 + 4 字节 UTF-8 序列的前 2 字节」
      connection.buffer = Buffer.concat([Buffer.from('ab'), Buffer.from('😀').subarray(0, 2)])
      // 模拟该数据已停留超过分包超时（默认 50ms）
      connection.pendingSince = Date.now() - 1000

      ;(client as any).processBuffer(connection)

      // 只输出可安全解码的部分，残缺字节必须保留
      expect(onData).toHaveBeenCalledTimes(1)
      expect(onData.mock.calls[0][0].data).toBe('ab')
      expect(connection.buffer.length).toBe(2)
      expect(connection.buffer[0]).toBe(0xf0)
      expect(connection.buffer[1]).toBe(0x9f)

      // 补齐剩余字节 + 换行符后，字符必须完整输出
      connection.port.emit(
        'data',
        Buffer.concat([Buffer.from('😀').subarray(2), Buffer.from('\r\n')])
      )
      await new Promise((r) => setTimeout(r, 50))

      const lastData = onData.mock.calls[onData.mock.calls.length - 1][0].data
      expect(lastData).toBe('😀')
    }, 10000)
  })

  describe('configurable packet timeout', () => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

    it('should default packetTimeout to 50ms', async () => {
      await startConnection('pt-default')
      expect(client.serialConnections.get('pt-default')!.packetTimeout).toBe(50)
    })

    it('should fall back to the default for invalid values', async () => {
      await startConnection('pt-invalid-1', vi.fn(), vi.fn(), { packetTimeout: -1 })
      await startConnection('pt-invalid-2', vi.fn(), vi.fn(), { packetTimeout: 999999 })
      await startConnection('pt-invalid-3', vi.fn(), vi.fn(), { packetTimeout: 'abc' })

      // 负数/非数字回退默认值，超大值收敛到上限
      expect(client.serialConnections.get('pt-invalid-1')!.packetTimeout).toBe(50)
      expect(client.serialConnections.get('pt-invalid-2')!.packetTimeout).toBe(60000)
      expect(client.serialConnections.get('pt-invalid-3')!.packetTimeout).toBe(50)
    })

    it('should keep 0 as "disabled" instead of falling back to the default', async () => {
      await startConnection('pt-zero', vi.fn(), vi.fn(), { packetTimeout: 0 })
      expect(client.serialConnections.get('pt-zero')!.packetTimeout).toBe(0)
    })

    it('should honor a custom packetTimeout', async () => {
      const onData = vi.fn()
      await startConnection('pt-custom', onData, vi.fn(), { packetTimeout: 20 })

      const connection = client.serialConnections.get('pt-custom')!
      connection.port.emit('data', Buffer.from('streaming'))
      await sleep(80)

      expect(onData).toHaveBeenCalled()
      expect(connection.buffer.length).toBe(0)
    }, 10000)

    it('should respect a longer packetTimeout', async () => {
      const onData = vi.fn()
      await startConnection('pt-long', onData, vi.fn(), { packetTimeout: 300 })

      const connection = client.serialConnections.get('pt-long')!
      connection.port.emit('data', Buffer.from('partial'))

      // 数据刚到达，停留时长远小于配置的 300ms，应继续等待换行符
      ;(client as any).processBuffer(connection)
      expect(onData).not.toHaveBeenCalled()
      expect(connection.buffer.toString()).toBe('partial')

      // 停留时长超过配置的超时后必须刷新
      connection.pendingSince = Date.now() - 400
      ;(client as any).processBuffer(connection)

      expect(onData).toHaveBeenCalledTimes(1)
      expect(onData.mock.calls[0][0].data).toBe('partial')
      expect(connection.buffer.length).toBe(0)
    }, 10000)

    it('should not flush while sending when packetTimeout is 0', async () => {
      // 0 = 禁用部分行停留刷新，退回"仅按换行符/空闲刷新输出"的原始语义
      const onData = vi.fn()
      await startConnection('pt-off', onData, vi.fn(), { packetTimeout: 0 })

      const connection = client.serialConnections.get('pt-off')!
      for (let i = 0; i < 10; i++) {
        connection.port.emit('data', Buffer.from('x'))
      }

      // 停留时长早已超过任何合理超时，但分包超时为 0，不能触发部分行刷新
      connection.pendingSince = Date.now() - 5000
      ;(client as any).processBuffer(connection)

      expect(onData).not.toHaveBeenCalled()
      expect(connection.buffer.length).toBe(10)
    }, 10000)

    it('should update packetTimeout via updateConfig without reopening the port', async () => {
      await startConnection('pt-update')
      const connection = client.serialConnections.get('pt-update')!
      const portBefore = connection.port
      const closeSpy = vi.spyOn(portBefore, 'close')

      const result = await client.updateConfig('pt-update', { packetTimeout: 20 })

      expect((result as any).success).toBe(true)
      expect(connection.packetTimeout).toBe(20)
      // 分包超时与硬件参数无关，不能重开端口（重开会复位设备）
      expect(closeSpy).not.toHaveBeenCalled()
      expect(client.serialConnections.get('pt-update')!.port).toBe(portBefore)
    }, 10000)

    it('should preserve packetTimeout when other params reopen the port', async () => {
      await startConnection('pt-carry', vi.fn(), vi.fn(), { packetTimeout: 80 })
      const connection = client.serialConnections.get('pt-carry')!

      // 改波特率会重开端口，分包超时配置不能被重置
      const result = await client.updateConfig('pt-carry', { baudRate: 115200 })

      expect((result as any).success).toBe(true)
      expect(client.serialConnections.get('pt-carry')!.packetTimeout).toBe(80)
      expect(connection.port.isOpen).toBe(false)
    }, 10000)
  })

  describe('config update buffer carry-over', () => {
    it('should flush undisplayed data before reopening the port', async () => {
      // 回归测试：updateConfig 重开端口时旧 buffer 被重置，
      // 已接收但未成行的数据会被静默丢弃（真实丢日志）。
      const onData = vi.fn()
      const onLog = vi.fn()
      await startConnection('carry-1', onData, onLog)

      const connection = client.serialConnections.get('carry-1')!
      connection.port.emit('data', Buffer.from('undisplayed payload'))

      const result = await client.updateConfig('carry-1', { baudRate: 115200 })
      expect(result.success).toBe(true)

      // 未显示的数据必须被抢救输出，而不是丢弃
      expect(onData).toHaveBeenCalledWith(expect.objectContaining({ data: 'undisplayed payload' }))
      expect(onLog).toHaveBeenCalled()
    }, 10000)
  })

  describe('disconnect()', () => {
    it('waits for the serial port close callback before resolving', async () => {
      await startConnection('close-1')
      const connection = client.serialConnections.get('close-1')!
      let finishClose: ((err: Error | null) => void) | undefined
      connection.port.close = vi.fn((callback) => {
        finishClose = callback
      })

      let settled = false
      const disconnectPromise = client.disconnect('close-1').then((result) => {
        settled = true
        return result
      })
      await Promise.resolve()

      expect(settled).toBe(false)
      expect(client.serialConnections.has('close-1')).toBe(true)

      finishClose?.(null)
      await expect(disconnectPromise).resolves.toMatchObject({ success: true })
      expect(client.serialConnections.has('close-1')).toBe(false)
    })

    it('keeps the connection when closing the serial port fails', async () => {
      await startConnection('close-error')
      const connection = client.serialConnections.get('close-error')!
      connection.port.close = vi.fn((callback) => callback(new Error('close failed')))

      await expect(client.disconnect('close-error')).resolves.toMatchObject({
        success: false,
        message: 'close failed'
      })
      expect(client.serialConnections.has('close-error')).toBe(true)
    })

    it('times out and keeps the connection when close never completes', async () => {
      await startConnection('close-timeout')
      const connection = client.serialConnections.get('close-timeout')!
      connection.port.close = vi.fn()
      vi.useFakeTimers()

      try {
        const disconnectPromise = client.disconnect('close-timeout')
        await vi.advanceTimersByTimeAsync(5000)

        await expect(disconnectPromise).resolves.toMatchObject({
          success: false,
          message: 'Timed out closing serial port after 5000ms'
        })
        expect(client.serialConnections.has('close-timeout')).toBe(true)

        connection.port.emit('close')
        expect(client.serialConnections.has('close-timeout')).toBe(false)
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
