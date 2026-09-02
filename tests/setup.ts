import './support/load-env'
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest'
import { installFetchFake, resetFetchFake } from './helpers/fetch-fake'
import {
  forgetVisitorSessions,
  issuedVisitorSessions,
  resetRequestContext,
} from './support/request-context'
import { sweepTestData, sweepVisitorConversations } from './helpers/db'

installFetchFake()

beforeAll(async () => {
  // A previous run that crashed mid-test would otherwise leave contacts sitting
  // in the inbox a reviewer opens.
  await sweepTestData()
})

beforeEach(() => {
  resetRequestContext()
  resetFetchFake()
  forgetVisitorSessions()
})

afterEach(async () => {
  resetFetchFake()
  // Web conversations have no prefix to sweep by, so they are cleared by the
  // session ids the routes handed out during this test.
  await sweepVisitorConversations(issuedVisitorSessions())
  forgetVisitorSessions()
})

afterAll(async () => {
  await sweepTestData()
})
