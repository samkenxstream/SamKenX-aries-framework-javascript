import type { OutboundTransport } from './OutboundTransport'
import type { OutboundWebSocketClosedEvent, OutboundWebSocketOpenedEvent } from './TransportEventTypes'
import type { Agent } from '../agent/Agent'
import type { AgentMessageReceivedEvent } from '../agent/Events'
import type { Logger } from '../logger'
import type { OutboundPackage } from '../types'
import type WebSocket from 'ws'

import { AgentEventTypes } from '../agent/Events'
import { AriesFrameworkError } from '../error/AriesFrameworkError'
import { isValidJweStructure, JsonEncoder } from '../utils'
import { Buffer } from '../utils/buffer'

import { TransportEventTypes } from './TransportEventTypes'

export class WsOutboundTransport implements OutboundTransport {
  private transportTable: Map<string, WebSocket> = new Map<string, WebSocket>()
  private agent!: Agent
  private logger!: Logger
  private WebSocketClass!: typeof WebSocket
  public supportedSchemes = ['ws', 'wss']

  public async start(agent: Agent): Promise<void> {
    this.agent = agent

    this.logger = agent.config.logger

    this.logger.debug('Starting WS outbound transport')
    this.WebSocketClass = agent.config.agentDependencies.WebSocketClass
  }

  public async stop() {
    this.logger.debug('Stopping WS outbound transport')
    this.transportTable.forEach((socket) => {
      socket.removeEventListener('message', this.handleMessageEvent)
      socket.close()
    })
  }

  public async sendMessage(outboundPackage: OutboundPackage) {
    const { payload, endpoint, connectionId } = outboundPackage
    this.logger.debug(`Sending outbound message to endpoint '${endpoint}' over WebSocket transport.`, {
      payload,
    })

    if (!endpoint) {
      throw new AriesFrameworkError("Missing connection or endpoint. I don't know how and where to send the message.")
    }

    const isNewSocket = this.hasOpenSocket(endpoint)
    const socket = await this.resolveSocket({ socketId: endpoint, endpoint, connectionId })

    socket.send(Buffer.from(JSON.stringify(payload)))

    // If the socket was created for this message and we don't have return routing enabled
    // We can close the socket as it shouldn't return messages anymore
    if (isNewSocket && !outboundPackage.responseRequested) {
      socket.close()
    }
  }

  private hasOpenSocket(socketId: string) {
    return this.transportTable.get(socketId) !== undefined
  }

  private async resolveSocket({
    socketId,
    endpoint,
    connectionId,
  }: {
    socketId: string
    endpoint?: string
    connectionId?: string
  }) {
    // If we already have a socket connection use it
    let socket = this.transportTable.get(socketId)

    if (!socket || socket.readyState === this.WebSocketClass.CLOSING) {
      if (!endpoint) {
        throw new AriesFrameworkError(`Missing endpoint. I don't know how and where to send the message.`)
      }
      socket = await this.createSocketConnection({
        endpoint,
        socketId,
        connectionId,
      })
      this.transportTable.set(socketId, socket)
      this.listenOnWebSocketMessages(socket)
    }

    if (socket.readyState !== this.WebSocketClass.OPEN) {
      throw new AriesFrameworkError('Socket is not open.')
    }

    return socket
  }

  // NOTE: Because this method is passed to the event handler this must be a lambda method
  // so 'this' is scoped to the 'WsOutboundTransport' class instance
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleMessageEvent = (event: any) => {
    this.logger.trace('WebSocket message event received.', { url: event.target.url })
    const payload = JsonEncoder.fromBuffer(event.data)
    if (!isValidJweStructure(payload)) {
      throw new Error(
        `Received a response from the other agent but the structure of the incoming message is not a DIDComm message: ${payload}`
      )
    }
    this.logger.debug('Payload received from mediator:', payload)

    this.agent.events.emit<AgentMessageReceivedEvent>(this.agent.context, {
      type: AgentEventTypes.AgentMessageReceived,
      payload: {
        message: payload,
      },
    })
  }

  private listenOnWebSocketMessages(socket: WebSocket) {
    socket.addEventListener('message', this.handleMessageEvent)
  }

  private createSocketConnection({
    socketId,
    endpoint,
    connectionId,
  }: {
    socketId: string
    endpoint: string
    connectionId?: string
  }): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      this.logger.debug(`Connecting to WebSocket ${endpoint}`)
      const socket = new this.WebSocketClass(endpoint)

      socket.onopen = () => {
        this.logger.debug(`Successfully connected to WebSocket ${endpoint}`)
        resolve(socket)

        this.agent.events.emit<OutboundWebSocketOpenedEvent>(this.agent.context, {
          type: TransportEventTypes.OutboundWebSocketOpenedEvent,
          payload: {
            socketId,
            connectionId: connectionId,
          },
        })
      }

      socket.onerror = (error) => {
        this.logger.debug(`Error while connecting to WebSocket ${endpoint}`, {
          error,
        })
        reject(error)
      }

      socket.onclose = async () => {
        this.logger.debug(`WebSocket closing to ${endpoint}`)
        socket.removeEventListener('message', this.handleMessageEvent)
        this.transportTable.delete(socketId)

        this.agent.events.emit<OutboundWebSocketClosedEvent>(this.agent.context, {
          type: TransportEventTypes.OutboundWebSocketClosedEvent,
          payload: {
            socketId,
            connectionId: connectionId,
          },
        })
      }
    })
  }
}
