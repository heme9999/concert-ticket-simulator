const copyTimers = new WeakMap<HTMLElement, number>();
let lastAnnouncement = '';

function legacyCopy(text: string): boolean {
  const field = Object.assign(document.createElement('textarea'), { value: text });
  field.setAttribute('readonly', '');
  field.style.cssText = 'position:fixed;inset-block-start:0;opacity:0';
  document.body.append(field);
  field.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    field.remove();
  }
}

function reportCopyStatus(button: HTMLElement, ok: boolean): void {
  const tip = button.nextElementSibling as HTMLElement | null;
  if (!tip) return;

  const existing = copyTimers.get(button);
  if (existing !== undefined) {
    window.clearTimeout(existing);
  }

  button.removeAttribute('data-copied');
  button.removeAttribute('data-failed');

  let message = ok ? 'Copied link' : 'Copy failed';
  if (message === lastAnnouncement) {
    message += '\u00A0';
  }
  lastAnnouncement = message;

  tip.textContent = '';
  void button.offsetWidth;
  button.setAttribute(ok ? 'data-copied' : 'data-failed', '');
  requestAnimationFrame(() => {
    tip.textContent = message;
  });

  const timerId = window.setTimeout(() => {
    button.removeAttribute('data-copied');
    button.removeAttribute('data-failed');
    tip.textContent = '';
  }, 2000);
  copyTimers.set(button, timerId);
}

export async function copyElementText(
  button: HTMLElement,
  target: HTMLElement,
): Promise<void> {
  const text = target.matches('input, textarea')
    ? (target as HTMLInputElement | HTMLTextAreaElement).value.trim()
    : target.innerText.trim();
  if (!text) return;

  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
    } else if (!legacyCopy(text)) {
      throw new Error('Clipboard unavailable');
    }
    reportCopyStatus(button, true);
  } catch {
    if (legacyCopy(text)) {
      reportCopyStatus(button, true);
    } else {
      reportCopyStatus(button, false);
    }
  }
}

/**
 * Registers Invoker Command (`--copy`) handler once on document, with fallback
 * click handler when CommandEvent is unsupported.
 */
export function registerCopyInvoker(): () => void {
  if (typeof document === 'undefined') return () => {};

  if ('CommandEvent' in window) {
    const onCommand = (event: Event) => {
      const cmdEvent = event as Event & {
        command?: string;
        source?: HTMLElement | null;
        target?: HTMLElement | null;
      };
      if (
        cmdEvent.command === '--copy' &&
        cmdEvent.source instanceof HTMLElement &&
        cmdEvent.target instanceof HTMLElement
      ) {
        void copyElementText(cmdEvent.source, cmdEvent.target);
      }
    };
    document.addEventListener('command', onCommand, true);
    return () => document.removeEventListener('command', onCommand, true);
  }

  const onClick = (event: MouseEvent) => {
    const targetEl = event.target;
    if (!(targetEl instanceof Element)) return;
    const button = targetEl.closest('button[command="--copy"]');
    if (!(button instanceof HTMLElement)) return;
    const targetId = button.getAttribute('commandfor');
    if (!targetId) return;
    const target = document.getElementById(targetId);
    if (target) {
      void copyElementText(button, target);
    }
  };
  document.addEventListener('click', onClick);
  return () => document.removeEventListener('click', onClick);
}
