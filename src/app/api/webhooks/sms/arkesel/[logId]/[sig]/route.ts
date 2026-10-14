import { NextResponse } from 'next/server'
import { ipHashOf } from '@/lib/authTokens'
import { recordDeliveryReport, reportSignatureValid } from '@/lib/messaging/smsReports'
import { LIMITS, SMS_REPORT_REFUSED, countRecent, record, tooMany } from '@/lib/rateLimit'
import { hasNullByte, jsonObject, unreadableBody, unreadableQuery } from '@/lib/validate'

/**
 * GET or POST /api/webhooks/sms/arkesel/<message log id>/<signature>?sms_id=...&status=...
 *
 * An SMS delivery report from Arkesel (lib/messaging/smsReports.ts). Arkesel
 * signs nothing, so the link is the proof: the signature is an HMAC of the
 * row's id with SMS_WEBHOOK_SECRET, checked in constant time, and the report
 * must carry the provider's id for that same message. Anything else is 404,
 * which says nothing about which part was wrong, and is counted against the
 * caller's address: after 20 in an hour that address is refused before
 * anything is checked.
 *
 * Arkesel's documentation says only that sms_id and status come as query
 * parameters, not which method it uses, so both are taken; a POST may carry
 * them in a JSON or form body instead.
 *
 * A report changes a row only from SENT, once, to DELIVERED or UNDELIVERED.
 * Sending the same report again changes nothing and is still 200, so Arkesel
 * has no reason to keep retrying it.
 */
type Params = { params: Promise<{ logId: string; sig: string }> }

export async function GET(req: Request, { params }: Params) {
  return handle(req, await params)
}

export async function POST(req: Request, { params }: Params) {
  return handle(req, await params)
}

const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404 })
const text = (value: unknown) => (typeof value === 'string' ? value.slice(0, 200) : null)

async function handle(req: Request, { logId, sig }: { logId: string; sig: string }) {
  const url = new URL(req.url)
  if (hasNullByte(url.searchParams)) return unreadableQuery()
  const ipHash = ipHashOf(req)
  const limit = LIMITS.smsReportRefusalsPerIp
  if (ipHash && (await countRecent(SMS_REPORT_REFUSED, { ipHash }, limit.windowMs)) >= limit.max) {
    return tooMany('Too many refused reports.', 3600)
  }
  const refuse = async () => {
    if (ipHash) await record(SMS_REPORT_REFUSED, { ipHash })
    return notFound()
  }

  if (!/^[A-Za-z0-9_-]{1,64}$/.test(logId) || !reportSignatureValid(logId, sig)) return refuse()

  let smsId = text(url.searchParams.get('sms_id'))
  let status = text(url.searchParams.get('status'))
  if ((!smsId || !status) && req.method === 'POST') {
    if ((req.headers.get('content-type') ?? '').includes('application/json')) {
      const body = await jsonObject(req)
      if (!body) return unreadableBody()
      smsId ??= text(body.sms_id)
      status ??= text(body.status)
    } else {
      const form = new URLSearchParams((await req.text()).slice(0, 4000))
      if (hasNullByte(form)) return unreadableBody()
      smsId ??= text(form.get('sms_id'))
      status ??= text(form.get('status'))
    }
  }

  const result = await recordDeliveryReport({ logId, smsId, status })
  if (result === 'not-found' || result === 'mismatch') return refuse()
  if (result === 'unreadable') return NextResponse.json({ error: 'No status' }, { status: 400 })
  return NextResponse.json({ received: true })
}
