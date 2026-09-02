import './support/load-env'
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest'
import { installFetchFake, resetFetchFake } from './helpers/fetch-fake'
import { resetRequestContext } from './support/request-context'
import { sweepTestData } from './helpers/db'

installFetchFake()

beforeAll(async () => {
  // A previous run that crashed mid-test would otherwise leave contacts sitting
  // in the inbox a reviewer opens.
  await sweepTestData()
})

beforeEach(() => {
  resetRequestContext()
  resetFetchFake()
})

afterEach(() => {
  resetFetchFake()
})

afterAll(async () => {
  await sweepTestData()
})
