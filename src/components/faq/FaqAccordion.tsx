'use client'

import * as Accordion from '@radix-ui/react-accordion'
import { ChevronDown } from 'lucide-react'

export function FaqAccordion({ questions }: { questions: { q: string; a: string }[] }) {
  return (
    <Accordion.Root type="single" collapsible className="border-t" style={{ borderColor: 'var(--color-border)' }}>
      {questions.map(({ q, a }) => (
        <Accordion.Item key={q} value={q} className="border-b" style={{ borderColor: 'var(--color-border)' }}>
          <Accordion.Header asChild>
            <h3 className="m-0" style={{ letterSpacing: 'inherit' }}>
              <Accordion.Trigger
                className="focus-ring w-full flex items-center justify-between gap-4 py-4 text-left text-[15px] font-semibold rounded-md"
                style={{ color: 'var(--color-text-primary)' }}
              >
                {q}
                <ChevronDown
                  size={18}
                  aria-hidden
                  className="faq-chevron flex-shrink-0"
                  style={{ color: 'var(--color-text-secondary)' }}
                />
              </Accordion.Trigger>
            </h3>
          </Accordion.Header>
          <Accordion.Content className="faq-content">
            <p className="pb-5 pr-8 text-[15px] leading-relaxed max-w-[65ch]" style={{ color: 'var(--color-text-secondary)' }}>
              {a}
            </p>
          </Accordion.Content>
        </Accordion.Item>
      ))}
    </Accordion.Root>
  )
}
