// The HTML version of an email, made from the same plain text that is stored
// in the message log, so the two can never say different things.

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const GOLD = '#C9932E'
const CREAM = '#FAF7F2'
const INK = '#1F1B16'

/**
 * `text` is paragraphs separated by blank lines. A paragraph of the form
 * "Label: https://…" becomes a button; the last paragraph is the footer.
 */
export function emailHtml(subject: string, text: string): string {
  const paragraphs = text.split(/\n{2,}/).filter(Boolean)
  const footer = paragraphs.length > 1 ? paragraphs.pop()! : ''
  const body = paragraphs.map((p) => {
    const button = /^([^:\n]{1,40}): (https?:\/\/\S+)$/.exec(p)
    if (button) {
      return `<p style="margin:28px 0"><a href="${escape(button[2])}" style="background:${GOLD};color:${INK};text-decoration:none;font-weight:700;padding:13px 26px;border-radius:999px;display:inline-block">${escape(button[1])}</a></p>`
    }
    return `<p style="margin:0 0 16px;line-height:1.6">${escape(p).replace(/\n/g, '<br>')}</p>`
  }).join('\n')
  const link = (t: string) => escape(t).replace(/(https?:\/\/[^\s<]+)/g, `<a href="$1" style="color:#6B645C">$1</a>`)

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(subject)}</title></head>
<body style="margin:0;background:${CREAM};font-family:Manrope,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:${INK}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:20px;overflow:hidden">
<tr><td style="background:${GOLD};padding:18px 28px;font-size:20px;font-weight:800;color:${INK}">FieGH</td></tr>
<tr><td style="padding:28px;font-size:15px">
<h1 style="margin:0 0 20px;font-size:20px;line-height:1.3">${escape(subject)}</h1>
${body}
</td></tr>
<tr><td style="padding:18px 28px;border-top:1px solid #EFE9DF;font-size:12px;line-height:1.5;color:#6B645C">${link(footer)}</td></tr>
</table></td></tr></table>
</body></html>`
}
