import Link from 'next/link'

// An empty state on a phone (app shell, stage 2): what is not here yet, in FieGH's words, and one thing to do about
// it. Desktop keeps its own (each page draws this with md:hidden beside it). The words are the owner's, approved on
// 2026-11-05; change them only with the owner.
type Action = { label: string } & ({ href: string; onClick?: never; disabled?: never } | { onClick: () => void; href?: never; disabled?: boolean })

export function PhoneEmpty({ title, text, action, className = '' }: { title: string; text: string; action: Action; className?: string }) {
  return (
    <div className={`phone-empty md:hidden ${className}`}>
      <p className="phone-empty-title">{title}</p>
      <p className="phone-empty-text">{text}</p>
      {action.href
        ? <Link href={action.href} className="phone-empty-action focus-ring">{action.label}</Link>
        : <button type="button" onClick={action.onClick} disabled={action.disabled} className="phone-empty-action focus-ring">{action.label}</button>}
    </div>
  )
}
