/**
 * crisisResources.ts — static support-resource list (zero imports).
 *
 * Free, 24/7, US numbers opened through core Linking (tel:/sms: only —
 * no web links, no tracking surface). These services are separate from
 * the app and never see the chat. Static content only: no detection,
 * no assessment, no care claims.
 *
 * Node-testable by design.
 */

export interface CrisisResource {
  label: string;
  sub: string;
  url: string;
}

export const CRISIS_SLIM_LINE = 'In crisis? Call or text 988 (US)';
export const CRISIS_TITLE = 'Support resources';
export const CRISIS_FOOTER = 'Free, 24/7, separate from this app. They never see your chat.';

export const CRISIS_RESOURCES: CrisisResource[] = [
  {
    label: 'Call 988',
    sub: 'Suicide and Crisis Lifeline, US, 24/7',
    url: 'tel:988',
  },
  {
    label: 'Text 988',
    sub: 'Suicide and Crisis Lifeline by text, US, 24/7',
    url: 'sms:988',
  },
  {
    label: 'Text HOME to 741741',
    sub: 'Crisis Text Line, US, 24/7',
    url: 'sms:741741',
  },
];
