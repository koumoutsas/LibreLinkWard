// jsdom lacks TextEncoder/TextDecoder, which react-router 7 needs at import time.
import { TextDecoder, TextEncoder } from 'util'

Object.assign(globalThis, { TextEncoder, TextDecoder })
