import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isBullMQEnabled } from '../config/bullmq.js'

// BullMQ must be explicit opt-in. It must NOT auto-enable merely because REDIS_HOST
// is set — on an incompatible Redis (< 5.0.0) the worker can't run, so enqueued jobs
// are never processed and emails are silently lost.
test('isBullMQEnabled is opt-in via BULLMQ_REMINDER_ENABLED only', () => {
  const prevFlag = process.env.BULLMQ_REMINDER_ENABLED
  const prevHost = process.env.REDIS_HOST
  try {
    delete process.env.BULLMQ_REMINDER_ENABLED
    process.env.REDIS_HOST = '192.168.0.1' // host present, flag off
    assert.equal(!!isBullMQEnabled(), false, 'must not auto-enable on REDIS_HOST')

    process.env.BULLMQ_REMINDER_ENABLED = '1'
    assert.equal(!!isBullMQEnabled(), true, 'enabled when flag = 1')

    process.env.BULLMQ_REMINDER_ENABLED = '0'
    assert.equal(!!isBullMQEnabled(), false, 'disabled when flag = 0')
  } finally {
    if (prevFlag === undefined) delete process.env.BULLMQ_REMINDER_ENABLED
    else process.env.BULLMQ_REMINDER_ENABLED = prevFlag
    if (prevHost === undefined) delete process.env.REDIS_HOST
    else process.env.REDIS_HOST = prevHost
  }
})
