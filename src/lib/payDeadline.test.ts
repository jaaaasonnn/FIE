import { describe, expect, it } from 'vitest'
import { formatPayBy } from './payDeadline'

// SU1: the 12 o'clock hour. en-GB with hour12: true is a 0-11 clock in Node's ICU, so a deadline at 12:34
// came out "0:34 pm" on the server (and "12:34 pm" in a browser, so React redrew the page). Checked in the
// six zones `npm run test:tz` runs in, given as the reader's zone, and in the process's own zone.

const ZONES = ['UTC', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Africa/Accra', 'Pacific/Auckland']
// Wednesday 10 March 2027: no zone here changes its clocks within a day of it
const DAY = { y: 2027, m: 3, d: 10 }

/** The moment that reads `hour:minute` on 10 March 2027 in `zone` */
function at(zone: string, hour: number, minute: number): Date {
  const wanted = Date.UTC(DAY.y, DAY.m - 1, DAY.d, hour, minute)
  const offset = (t: number) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
      .formatToParts(new Date(t)).map((x) => [x.type, x.value]))
    return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute)) - t
  }
  return new Date(wanted - offset(wanted - offset(wanted)))
}

const CASES: [number, number, string][] = [
  [0, 0, '12:00 am'], [0, 34, '12:34 am'], [0, 59, '12:59 am'],
  [12, 0, '12:00 pm'], [12, 34, '12:34 pm'], [12, 59, '12:59 pm'],
  // either side of the hour
  [11, 59, '11:59 am'], [13, 0, '1:00 pm'], [23, 59, '11:59 pm'], [1, 0, '1:00 am'],
]
const FAR_AWAY = new Date('2027-06-01T12:00:00Z')

describe('formatPayBy writes the 12 o\'clock hour as 12, never 0', () => {
  for (const zone of ZONES) {
    it.each(CASES)(`in ${zone}: %i:%i is "%s"`, (hour, minute, time) => {
      const moment = at(zone, hour, minute)
      expect(formatPayBy(moment, FAR_AWAY, zone)).toBe(`Wed 10 Mar, ${time}`)
      expect(formatPayBy(moment, moment, zone)).toBe(`${time} today`)
    })
  }

  it.each(CASES)('in the process\'s own zone (TZ): %i:%i is "%s"', (hour, minute, time) => {
    const moment = new Date(DAY.y, DAY.m - 1, DAY.d, hour, minute)
    expect(formatPayBy(moment, FAR_AWAY)).toBe(`Wed 10 Mar, ${time}`)
  })
})
